import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase, supabaseUrl } from "@/supabase/client";
import { sha256Hex } from "./sha256";
import { runGithubSync } from "./github";
import { IS_STATIC_SNAPSHOT } from "../static/fetch";
import {
  DEFAULT_BACKGROUNDS,
  KEY_SALT,
  type BackgroundConfig,
  type GithubRepoRow,
  type GithubSyncState,
  type Project,
  type SectionKey,
  type SiteSettings,
} from "./types";

const EDIT_FLAG = "pf-editor-unlocked";

export type SettingsTab = "key" | "profile" | "background" | "projects" | "github";

const FALLBACK_SETTINGS: SiteSettings = {
  username: "eggLi",
  avatar_url: null,
  tagline: "用 AI 造温柔的小玩具，也陪开源项目走一段路",
  bio: "",
  social_links: [],
  backgrounds: {},
};

type SiteValue = {
  loading: boolean;
  saving: boolean;
  settings: SiteSettings;
  projects: Project[];
  visibleProjects: Project[];
  editMode: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  setSettingsTab: (t: SettingsTab) => void;
  setSettingsOpen: (v: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
  unlock: (key: string) => Promise<boolean>;
  lock: () => void;
  saveSettings: (patch: Partial<SiteSettings>) => Promise<void>;
  saveProject: (project: Project) => Promise<void>;
  /** 局部更新项目字段（GitHub 派生项目的体验入口等），写库 + 同步本地 state */
  patchProject: (id: string, patch: Partial<Project>) => Promise<void>;
  createProject: (input: Partial<Project>) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
  bgFor: (key: SectionKey) => BackgroundConfig;
  refresh: () => Promise<void>;
  /** GitHub 同步：仓库清单 + 同步状态 */
  ghRepos: GithubRepoRow[];
  ghState: GithubSyncState | null;
  ghBusy: boolean;
  syncGithub: () => Promise<string>;
  toggleRepoShow: (repo: GithubRepoRow, show: boolean) => Promise<void>;
  saveRepoIntro: (repo: GithubRepoRow, intro: string) => Promise<void>;
};

const SiteContext = createContext<SiteValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SiteSettings>(FALLBACK_SETTINGS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("key");
  const [ghRepos, setGhRepos] = useState<GithubRepoRow[]>([]);
  const [ghState, setGhState] = useState<GithubSyncState | null>(null);
  const [ghBusy, setGhBusy] = useState(false);

  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsTab((prev) => {
      if (tab) return tab;
      const unlocked = sessionStorage.getItem(EDIT_FLAG) === "1";
      return unlocked ? prev : "key";
    });
    setSettingsOpen(true);
  }, []);

  const refresh = useCallback(async () => {
    const [s, p, g, gs] = await Promise.all([
      supabase.from("site_settings").select().eq("id", 1).maybeSingle(),
      supabase.from("projects").select().order("sort_order", { ascending: true }),
      supabase.from("github_repos").select().order("name", { ascending: true }),
      supabase.from("github_sync_state").select().eq("id", 1).maybeSingle(),
    ]);
    if (s.error) console.error("读取站点设置失败:", s.error.message);
    if (s.data) {
      setSettings({
        username: s.data.username ?? FALLBACK_SETTINGS.username,
        avatar_url: s.data.avatar_url ?? null,
        tagline: s.data.tagline ?? "",
        bio: s.data.bio ?? "",
        social_links: Array.isArray(s.data.social_links) ? (s.data.social_links as SiteSettings["social_links"]) : [],
        backgrounds: (s.data.backgrounds ?? {}) as SiteSettings["backgrounds"],
      });
    }
    if (p.error) console.error("读取项目失败:", p.error.message);
    setProjects((p.data ?? []) as unknown as Project[]);
    setGhRepos((g.data ?? []) as unknown as GithubRepoRow[]);
    if (gs.data) setGhState(gs.data as unknown as GithubSyncState);
  }, []);

  useEffect(() => {
    setEditMode(sessionStorage.getItem(EDIT_FLAG) === "1");
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const unlock = useCallback(async (key: string) => {
    const hash = await sha256Hex(`${KEY_SALT}:${key.trim()}`);
    const res = await fetch(`${supabaseUrl}/functions/v1/verify-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    if (data.ok) {
      sessionStorage.setItem(EDIT_FLAG, "1");
      setEditMode(true);
      return true;
    }
    return false;
  }, []);

  const lock = useCallback(() => {
    sessionStorage.removeItem(EDIT_FLAG);
    setEditMode(false);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<SiteSettings>) => {
    setSaving(true);
    try {
      setSettings((prev) => ({ ...prev, ...patch }));
      const merged = { ...settings, ...patch };
      const { data, error } = await supabase
        .from("site_settings")
        .update({
          username: merged.username,
          avatar_url: merged.avatar_url,
          tagline: merged.tagline,
          bio: merged.bio,
          social_links: merged.social_links,
          backgrounds: merged.backgrounds,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
        .select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("保存未生效，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  /** GitHub 派生项目也在这里更新。⚠️ supabase types 未覆盖 gh_* 派生列，故按行写入 */
  const patchProject = useCallback(async (id: string, patch: Partial<Project>) => {
    const { data, error } = await supabase
      .from("projects")
      .update(patch as never)
      .eq("id", id)
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("更新失败：可能被权限策略拦截");
    setProjects((prev) => prev.map((p) => (p.id === id ? (data[0] as unknown as Project) : p)));
  }, []);

  const createProject = useCallback(async (input: Partial<Project>) => {
    const maxOrder = projects.reduce((m, p) => Math.max(m, p.sort_order), 0);
    const payload = {
      title: input.title ?? "未命名项目",
      description: input.description ?? "",
      tags: input.tags ?? [],
      cover_url: input.cover_url ?? null,
      demo_mode: input.demo_mode ?? "none",
      entry_url: input.entry_url ?? null,
      source_url: input.source_url ?? null,
      source_name: input.source_name ?? null,
      files: input.files ?? [],
      source_files: input.source_files ?? [],
      external_url: input.external_url ?? null,
      sort_order: maxOrder + 1,
      hidden: input.hidden ?? false,
    };
    const { data, error } = await supabase.from("projects").insert(payload).select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("写入失败：可能被权限策略拦截");
    setProjects((prev) => [...prev, data[0] as unknown as Project]);
    return (data[0] as unknown as Project) ?? null;
  }, [projects]);

  const saveProject = useCallback(async (project: Project) => {
    const { data, error } = await supabase
      .from("projects")
      .update({
        title: project.title,
        description: project.description,
        tags: project.tags,
        cover_url: project.cover_url,
        demo_mode: project.demo_mode,
        entry_url: project.entry_url,
        source_url: project.source_url,
        source_name: project.source_name,
        files: project.files,
        source_files: project.source_files ?? [],
        external_url: project.external_url,
        hidden: project.hidden,
        // 站长手动改过的字段名单：同步任务据此跳过，不再覆盖
        overridden_fields: project.overridden_fields ?? [],
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", project.id)
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("更新失败：可能被权限策略拦截");
    setProjects((prev) => prev.map((p) => (p.id === project.id ? (data[0] as unknown as Project) : p)));
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("projects").delete().eq("id", id).select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("删除失败：记录不存在或权限不足");
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const reorderProjects = useCallback(async (orderedIds: string[]) => {
    setProjects((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      return orderedIds.map((id, i) => ({ ...(map.get(id) as Project), sort_order: i }));
    });
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase.from("projects").update({ sort_order: i }).eq("id", orderedIds[i]);
      if (error) throw new Error(error.message);
    }
  }, []);

  const bgFor = useCallback(
    (key: SectionKey): BackgroundConfig => settings.backgrounds[key] ?? DEFAULT_BACKGROUNDS[key],
    [settings.backgrounds],
  );

  /** 手动触发一次组织同步；成功后刷新全站数据 */
  const syncGithub = useCallback(async (): Promise<string> => {
    setGhBusy(true);
    try {
      const res = await runGithubSync();
      await refresh();
      return `已同步 ${res.total} 个展示仓库（新增 ${res.created}，更新 ${res.updated}）${res.listed > 0 ? `，新上架 ${res.listed} 个作品` : ""}`;
    } finally {
      setGhBusy(false);
    }
  }, [refresh]);

  /**
   * 每日自动核对：平台侧定时调度暂未开放，改为「打开站点时按天节流」触发。
   * 同一自然日内只请求一次，失败静默（不打扰访客），下次打开再试。
   */
  const DAILY_SYNC_KEY = "pf-gh-last-sync";
  useEffect(() => {
    if (IS_STATIC_SNAPSHOT) return;
    if (loading) return;
    const today = new Date().toISOString().slice(0, 10);
    let last: string | null = null;
    try {
      last = localStorage.getItem(DAILY_SYNC_KEY);
    } catch {
      return;
    }
    if (last === today) return;
    try {
      localStorage.setItem(DAILY_SYNC_KEY, today);
    } catch {
      // 隐私模式下写入失败也继续同步，只是可能重复触发
    }
    void (async () => {
      try {
        await runGithubSync();
        await refresh();
      } catch {
        try {
          localStorage.removeItem(DAILY_SYNC_KEY);
        } catch {
          // 忽略
        }
      }
    })();
  }, [loading, refresh]);

  /** 勾选/取消「展示在网站」：派生项目由云函数负责创建与清理 */
  const toggleRepoShow = useCallback(async (repo: GithubRepoRow, show: boolean) => {
    setGhBusy(true);
    try {
      const { data, error } = await supabase
        .from("github_repos")
        .update({ show_on_site: show, updated_at: new Date().toISOString() })
        .eq("id", repo.id)
        .select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("更新失败：可能被权限策略拦截");
      await refresh();
    } finally {
      setGhBusy(false);
    }
  }, [refresh]);

  /** 站长手改中文介绍：置 intro_source='manual'，之后同步不再覆盖 */
  const saveRepoIntro = useCallback(async (repo: GithubRepoRow, intro: string) => {
    const { data, error } = await supabase
      .from("github_repos")
      .update({ intro_zh: intro.trim(), intro_source: "manual", updated_at: new Date().toISOString() })
      .eq("id", repo.id)
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("保存失败：可能被权限策略拦截");
    setGhRepos((prev) => prev.map((r) => (r.id === repo.id ? ({ ...r, intro_zh: intro.trim(), intro_source: "manual" }) : r)));
  }, []);

  const value = useMemo<SiteValue>(
    () => ({
      loading,
      saving,
      settings,
      projects,
      visibleProjects: editMode ? projects : projects.filter((p) => !p.hidden),
      editMode,
      settingsOpen,
      settingsTab,
      setSettingsTab,
      setSettingsOpen,
      openSettings,
      unlock,
      lock,
      saveSettings,
      saveProject,
      patchProject,
      createProject,
      deleteProject,
      reorderProjects,
      bgFor,
      refresh,
      ghRepos,
      ghState,
      ghBusy,
      syncGithub,
      toggleRepoShow,
      saveRepoIntro,
    }),
    [loading, saving, settings, projects, editMode, settingsOpen, settingsTab, openSettings, unlock, lock, saveSettings, saveProject, patchProject, createProject, deleteProject, reorderProjects, bgFor, refresh, ghRepos, ghState, ghBusy, syncGithub, toggleRepoShow, saveRepoIntro],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite 必须在 SiteProvider 内使用");
  return ctx;
}
