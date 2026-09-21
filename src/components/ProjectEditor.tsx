import { useEffect, useMemo, useRef, useState } from "react";
import { FileArchive, Loader2, Sparkles, X } from "lucide-react";
import { useSite } from "@/lib/site-context";
import type { DemoMode, Project, ProjectFile, SourceFileEntry } from "@/lib/types";
import { uploadSourceZip } from "@/lib/project-upload";
import { formatBytes, MAX_SINGLE_FILE, MAX_TOTAL_SIZE } from "@/lib/storage";
import { generateCover } from "@/lib/cover";
import { AuroraButton } from "@/components/ui/aurora-button";
import { ImageUploader } from "@/components/ImageUploader";
import { DemoContentEditor } from "@/components/DemoContentEditor";
import { toast } from "sonner";

type Draft = {
  title: string;
  description: string;
  tags: string;
  cover_url: string | null;
  entry_url: string | null;
  external_url: string | null;
  files: ProjectFile[];
  source_url: string | null;
  source_name: string | null;
  source_files: SourceFileEntry[];
  hidden: boolean;
};

const EMPTY: Draft = {
  title: "",
  description: "",
  tags: "",
  cover_url: null,
  entry_url: null,
  external_url: null,
  files: [],
  source_url: null,
  source_name: null,
  source_files: [],
  hidden: false,
};

export function ProjectEditor({ target, onClose }: { target: Project | "new" | null; onClose: () => void }) {
  const { createProject, saveProject, ghRepos, saveRepoIntro } = useSite();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const srcRef = useRef<HTMLInputElement>(null);

  const isNew = target === "new";
  // 新建时上传需要一个稳定的项目 id，不能每次渲染都换一个
  const draftId = useMemo(() => `p${Date.now().toString(36)}`, [target]);
  const projectId = isNew || !target ? draftId : (target as Project).id;

  useEffect(() => {
    if (!target) return;
    if (target === "new") {
      setDraft(EMPTY);
    } else {
      setDraft({
        title: target.title,
        description: target.description,
        tags: target.tags.join("、"),
        cover_url: target.cover_url,
        entry_url: target.entry_url,
        external_url: target.external_url,
        files: target.files ?? [],
        source_url: target.source_url,
        source_name: target.source_name,
        source_files: target.source_files ?? [],
        hidden: target.hidden,
      });
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [target]);

  if (!target) return null;

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const isGithubProject = !isNew && (target as Project).origin === "github";

  async function submit() {
    if (!draft.title.trim()) {
      toast.error("请填写项目名称");
      return;
    }
    setBusy("正在保存…");
    try {
      const tags = draft.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
      const demo_mode: DemoMode = draft.external_url ? "external" : draft.entry_url ? "inline" : "none";
      const entry_url = demo_mode === "inline" ? draft.entry_url : null;

      if (isNew) {
        await createProject({ ...draft, title: draft.title.trim(), tags, demo_mode, entry_url });
      } else if (isGithubProject) {
        const cur = target as Project;
        // 记下这次真正改动过的字段：同步任务见到名单里的字段就整列跳过，不再用仓库数据覆盖。
        // 用并集而非替换，避免第二次编辑把上一次的锁定项清空。
        const locked = new Set(cur.overridden_fields ?? []);
        if (draft.title.trim() !== cur.title) locked.add("title");
        if (draft.description !== cur.description) locked.add("description");
        if (tags.join("|") !== (cur.tags ?? []).join("|")) locked.add("tags");
        if (draft.hidden !== cur.hidden) locked.add("hidden");
        if (entry_url !== cur.entry_url || draft.external_url !== cur.external_url) {
          locked.add("entry_url");
          locked.add("demo_mode");
        }

        await saveProject({
          ...cur,
          title: draft.title.trim(),
          description: draft.description,
          tags,
          cover_url: draft.cover_url,
          demo_mode,
          entry_url,
          external_url: draft.external_url,
          hidden: draft.hidden,
          overridden_fields: [...locked],
        });

        // 简介同时写进 github_repos，让「设置 → GitHub」里的中文介绍与这里保持一致
        const repo = ghRepos.find((r) => r.project_id === cur.id);
        if (repo && draft.description !== cur.description) {
          try {
            await saveRepoIntro(repo, draft.description);
          } catch {
            // 主保存已成功，这里失败只是两处显示暂时不一致
          }
        }
      } else {
        await saveProject({ ...(target as Project), ...draft, title: draft.title.trim(), tags, demo_mode, entry_url });
      }
      toast.success(isNew ? "作品已发布" : "修改已保存");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function handleSourceZip(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_TOTAL_SIZE || file.size > MAX_SINGLE_FILE) {
      toast.error(`源码包 ${formatBytes(file.size)} 超出单文件 ${formatBytes(MAX_SINGLE_FILE)} 上限`);
      return;
    }
    setBusy("正在上传源码包…");
    try {
      const src = await uploadSourceZip(file, projectId);
      patch({ source_url: src.url, source_name: src.name, source_files: src.entries });
      toast.success(src.entries.length > 0 ? `源码包已上传（${src.entries.length} 个文件可在线浏览）` : "源码包已上传");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
      if (srcRef.current) srcRef.current.value = "";
    }
  }

  /** 按项目内容让 AI 画一张统一风格的封面（生图 10~30s，期间禁用按钮防重复触发） */
  async function genCover() {
    setCoverBusy(true);
    try {
      const { url } = await generateCover({
        id: projectId,
        title: draft.title.trim() || "未命名作品",
        description: draft.description,
        tags: draft.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6),
        gh_language: isNew ? null : (target as Project).gh_language,
      });
      patch({ cover_url: url });
      toast.success("封面已生成，保存后生效");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成封面失败");
    } finally {
      setCoverBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-input bg-white/75 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-lilac/60 focus:ring-2 focus:ring-lilac/25";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/35 backdrop-blur-md sm:items-center sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-pop-in flex max-h-[94svh] w-full flex-col overflow-hidden rounded-t-3xl bg-popover shadow-2xl ring-1 ring-white/50 sm:max-w-2xl sm:rounded-3xl"
      >
        <div className="aurora-bg flex shrink-0 items-center justify-between px-6 py-4">
          <h3 className="font-display text-lg font-bold text-ink">{isNew ? "上传新作品" : isGithubProject ? "编辑 GitHub 作品" : "编辑作品"}</h3>
          <AuroraButton variant="ghost" size="iconSm" onClick={onClose}><X size={16} /></AuroraButton>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {isGithubProject && (
            <p className="rounded-xl bg-butter/12 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-amber-800">
              这个项目由 GitHub 组织自动同步。<strong>你改过的字段会被锁定</strong>，不再被每日同步覆盖；没改过的继续自动更新（仓库名、星数、README）。
            </p>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">项目名称 *</label>
            <input className={inputCls} value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="例如：柔光天气卡片" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">一句话简介</label>
            <textarea className={inputCls + " min-h-[76px] resize-y"} value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="它解决什么问题、有什么好玩的地方" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">标签（最多 6 个，用逗号或顿号分隔）</label>
            <input className={inputCls} value={draft.tags} onChange={(e) => patch({ tags: e.target.value })} placeholder="React、Canvas、小工具" />
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <AuroraButton variant="soft" size="sm" disabled={coverBusy} onClick={() => void genCover()}>
                {coverBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {coverBusy ? "正在生成…" : draft.cover_url ? "重新生成封面" : "AI 生成封面"}
              </AuroraButton>
              <span className="text-[11px] text-muted-foreground">按名称 / 简介 / 标签自动画一张，与全站封面同一套画风</span>
            </div>
            <ImageUploader label="封面图（也可以自己上传）" value={draft.cover_url} onChange={(url) => patch({ cover_url: url })} aspect="16 / 9" hint="建议 1600×900，PNG / JPG，≤8MB" />
          </div>

          <DemoContentEditor
            key={projectId}
            variant={isGithubProject ? "github" : "full"}
            projectId={projectId}
            value={{ entry_url: draft.entry_url, external_url: draft.external_url, files: draft.files }}
            onChange={(p) => patch(p)}
          />

          {!isGithubProject && (
            <div className="rounded-2xl border border-sky/20 bg-sky/5 p-4">
              <p className="mb-1 text-xs font-semibold text-ink">源代码包（可选）</p>
              <p className="mb-3 text-[11px] text-muted-foreground">像 GitHub 那样提供可下载的源码 zip，与体验内容互不影响。</p>
              <div className="flex flex-wrap items-center gap-2">
                <AuroraButton variant="soft" size="sm" onClick={() => srcRef.current?.click()}>
                  <FileArchive size={13} /> {draft.source_url ? "替换源码包" : "上传源码 zip"}
                </AuroraButton>
                {draft.source_url && (
                  <>
                    <span className="truncate font-mono text-[11px] text-sky">{draft.source_name}</span>
                    <button type="button" onClick={() => patch({ source_url: null, source_name: null })} className="text-[11px] text-destructive hover:underline">
                      移除
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
            <input type="checkbox" checked={draft.hidden} onChange={(e) => patch({ hidden: e.target.checked })} className="h-4 w-4 accent-[var(--color-lilac)]" />
            暂时隐藏（自己可见，访客看不到）
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-white/60 px-6 py-4">
          <AuroraButton variant="ghost" size="md" onClick={onClose}>取消</AuroraButton>
          <AuroraButton variant="glow" size="md" onClick={() => void submit()} disabled={Boolean(busy)}>
            {busy ? <><Loader2 size={14} className="animate-spin" /> {busy}</> : isNew ? "发布作品" : "保存修改"}
          </AuroraButton>
        </div>

        <input ref={srcRef} type="file" accept=".zip" className="hidden" onChange={(e) => void handleSourceZip(e.target.files?.[0])} />
      </div>
    </div>
  );
}
