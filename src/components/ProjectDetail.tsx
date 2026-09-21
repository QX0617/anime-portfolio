import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Code2, Download, ExternalLink, Github, Loader2, Maximize2, Minimize2, Rocket, Sparkles, Star, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import { useSite } from "@/lib/site-context";
import { fetchEntryMeta, fetchHtmlText, fetchMirroredHtml, fetchReadme, githubRawUrl, mirroredSize } from "@/lib/github";
import { generateCover } from "@/lib/cover";
import { uploadSingleHtml } from "@/lib/project-upload";
import { formatBytes, MAX_SINGLE_FILE } from "@/lib/storage";
import { AuroraButton, AuroraLink } from "@/components/ui/aurora-button";
import { MarkdownView } from "@/lib/markdown";
import { SourceBrowser, type SourceContent } from "@/components/SourceBrowser";
import { cn } from "@/lib/utils";

type Tab = "demo" | "readme" | "source";

/** 从源码归档里找 README（优先根目录、层级最浅的那个） */
function findReadme(entries: { path: string; size: number }[]): string | null {
  const hits = entries.filter((e) => /(^|\/)readme(\.(md|markdown|txt))?$/i.test(e.path));
  if (hits.length === 0) return null;
  return hits.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.length - b.path.length)[0].path;
}

/** 从 blob 加载的 HTML 丢了原始目录，注入 <base> 让相对资源仍按仓库目录解析 */
function withBase(html: string, base: string): string {
  const tag = `<base href="${base}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

/**
 * srcDoc 的 iframe 与父页面同源，可以直接读它的文档树 —— 用来发现「白屏」这种最容易被忽略的失败。
 * 典型场景：仓库的入口是开发态源码（`<div id="root"></div>` + `/src/main.jsx`），
 * 站内既拿不到脚本也跑不了 JSX，渲染出来就是纯白，用户只会以为「网站坏了」。
 * 读不到（跨域等）时一律按「不空」处理，宁可不提示也不误报。
 */
function frameLooksEmpty(frame: HTMLIFrameElement | null): boolean {
  try {
    const doc = frame?.contentDocument;
    if (!doc || !doc.body) return false;
    if ((doc.body.textContent ?? "").trim().length > 0) return false;
    const painted = Array.from(doc.body.children).some((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 8 && rect.height > 8 && style.display !== "none" && style.visibility !== "hidden";
    });
    return !painted;
  } catch {
    return false;
  }
}

export function ProjectDetail({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { editMode, patchProject } = useSite();
  const [fullscreen, setFullscreen] = useState(false);
  const [tab, setTab] = useState<Tab>("demo");
  const [readme, setReadme] = useState<{ path: string; text: string } | null>(null);
  const [readmeState, setReadmeState] = useState<"idle" | "loading" | "error">("idle");
  const [readmeError, setReadmeError] = useState("");

  const isGithub = project?.origin === "github" && Boolean(project.gh_full_name);
  // ⚠️ owner/repo 必须拆成字符串再进依赖：split() 每次渲染都是新数组，
  // 直接依赖数组会让 effect 每帧重跑，README 请求会被无限重复发出。
  const ghKey = isGithub ? (project!.gh_full_name as string) : "";
  const ghOwner = ghKey.slice(0, ghKey.indexOf("/"));
  const ghRepo = ghKey.slice(ghKey.indexOf("/") + 1);
  const ghRef = project?.default_branch ?? "HEAD";
  const hasGhParts = isGithub && ghKey.includes("/") && ghOwner.length > 0 && ghRepo.length > 0;

  const sourceEntries = useMemo(() => project?.source_files ?? [], [project]);
  const readmePath = useMemo(
    () => (isGithub ? (project!.readme_path_hint ?? null) : findReadme(sourceEntries)),
    [isGithub, project, sourceEntries],
  );
  // GitHub 项目优先直连仓库 raw（永远是最新代码，且不受本站镜像体积上限约束）；
  // 读不到再退回站内 entry_url 镜像（同步任务搬的小文件，或站长手动上传的）。
  const rawDemoUrl = useMemo(
    () =>
      hasGhParts && project?.gh_entry_path
        ? githubRawUrl(ghOwner, ghRepo, ghRef, project.gh_entry_path)
        : null,
    [hasGhParts, ghOwner, ghRepo, ghRef, project?.gh_entry_path],
  );

  // 有站内体验页、raw 直链或外部链接就能打开体验 tab。
  const canExperience = Boolean(
    project &&
      (project.demo_mode === "external"
        ? project.external_url
        : project.entry_url || rawDemoUrl),
  );
  const hasSource = isGithub || sourceEntries.length > 0 || Boolean(project?.source_url);
  // entry_url 进了锁定名单 = 站长手动传过体验页，站内版本要优先于 GitHub raw
  const manualEntry = Boolean(project?.entry_url && project?.overridden_fields?.includes("entry_url"));

  // 在线体验的加载顺序（三类项目共用一条管线）：
  // 1) 外部链接 → 第三方站点 content-type 正常，交给 iframe 直挂；
  // 2) GitHub 项目 → **站内镜像优先**（秒开、不依赖能否访问 GitHub），失败再退回仓库 raw；
  // 3) 手动项目 → 站内 entry_url 镜像。
  // ⚠️ 站内镜像必须拉文本后交给 iframe 的 srcDoc —— 平台读取 storage 对象时会把 content-type
  // 统一改写成 text/plain，iframe 直挂会被当纯文本显示成源码。
  // ⚠️ 顺序不能反过来：raw 直连在访问不到 GitHub 的环境里要干等 12s 超时，用户会以为「打不开」。
  const [demoState, setDemoState] = useState<"idle" | "loading" | "error">("idle");
  const [demoError, setDemoError] = useState("");
  const [demoNonce, setDemoNonce] = useState(0);
  /** 当前画面来自哪条路：站内快照 / 仓库最新版 / 外部链接 —— 用于给用户一句实话 */
  const [demoSource, setDemoSource] = useState<"mirror" | "raw" | "external" | null>(null);
  // ⚠️ 用 srcDoc 而不是 Blob URL：Blob URL 的 origin 是 "null"，iframe 里
  // localStorage / IndexedDB 会被浏览器直接拒绝，依赖本地存储的应用（如 408- 的题库）
  // 会静默降级成空数据。srcDoc 继承父页面 origin，存储 API 正常可用。
  const [demoHtml, setDemoHtml] = useState<string | null>(null);
  /** srcDoc 渲染完仍是一片空白（多半是把开发态源码入口当成了体验页） */
  const [frameEmpty, setFrameEmpty] = useState(false);
  const demoFrameRef = useRef<HTMLIFrameElement | null>(null);
  // 进度条：拉取阶段 0-70%，iframe 内部资源加载完再补到 100%
  const [progress, setProgress] = useState(0);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (demoState !== "loading") return;
    setProgress(6);
    const timer = window.setInterval(() => {
      setProgress((p) => (p >= 68 ? 68 : p + Math.max(1, Math.round((68 - p) / 8))));
    }, 220);
    return () => window.clearInterval(timer);
  }, [demoState, demoNonce]);

  useEffect(() => {
    if (demoState !== "loading" || !frameReady) return;
    setProgress(100);
    const timer = window.setTimeout(() => setDemoState("idle"), 320);
    return () => window.clearTimeout(timer);
  }, [demoState, frameReady]);

  useEffect(() => {
    let cancelled = false;
    if (!project || !canExperience) {
      // 源码工程没有构建产物时就走这里：明确记一条，便于确认「白屏」已不会再出现
      if (project && project.demo_mode !== "external") {
        console.info(
          `[ProjectDetail] 该项目没有可体验入口，展示占位与引导 project=${project.id} demo_mode=${project.demo_mode} 来源=${project.origin ?? "manual"}`,
        );
      }
      setDemoState("idle");
      return;
    }
    // 外部链接类型：第三方站点 content-type 正常，直接交给 iframe，不用拉文本
    if (project.demo_mode === "external") {
      setDemoHtml(null);
      setFrameReady(false);
      setDemoSource("external");
      setDemoState("idle");
      return;
    }
    const entry = typeof project.entry_url === "string" ? project.entry_url : "";
    const show = (text: string, from: "mirror" | "raw") => {
      if (cancelled) return;
      console.info(`[ProjectDetail] 体验页就绪 来源=${from} ${Math.round(text.length / 1024)}KB project=${project.id}`);
      setFrameReady(false);
      setDemoSource(from);
      setDemoHtml(text);
      setFrameEmpty(false);
      // 保持 loading：等 iframe 的 onLoad 触发后再收掉进度条，避免半成品页面先露出来
    };

    const load = async () => {
      setFrameReady(false);
      setDemoState("loading");
      const t0 = Date.now();
      const fromRaw = async () => {
        const url = rawDemoUrl as string;
        // ⚠️ 必须带超时：访问不到 GitHub 的环境不能让体验区一直挂在 loading 上。
        // 6s 足够正常网络拉完，超时立刻回退，用户不会干等。
        // ⚠️ 超时抛的是 AbortError，必须在这里就地转成可读文案 —— 否则它会一路冒泡成
        // 用户看不懂的「Uncaught AbortError」，而且看不出到底是哪条来源失败。
        let res: Response;
        try {
          res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error("仓库页面读取超时（6 秒），当前网络可能访问不到 GitHub");
          }
          throw e instanceof Error ? e : new Error("仓库页面读取失败");
        }
        if (!res.ok) throw new Error(`仓库页面读取失败 (${res.status})`);
        // 注入 <base>：相对路径（assets/…）仍按仓库目录解析
        return withBase(await res.text(), url.slice(0, url.lastIndexOf("/") + 1));
      };
      const fromMirror = async () => {
        if (!entry) throw new Error("这个页面还没有可体验的站内版本。可以先去 GitHub 查看源码。");
        return await fetchMirroredHtml(entry);
      };

      // 站内快照优先（秒开、不依赖 GitHub 可达性）；只有**同步任务自动搬来的**快照
      // 才做「是否落后」的体积比对：那是某一刻的拷贝，仓库之后更新过就会缺功能。
      // ⚠️ 站长**手动上传**过的体验页（entry_url 进 overridden_fields）跳过比对，固定第一顺位：
      // 那份是站长挑出来的、确认能跑起来的版本，而仓库里的文件可能根本跑不起来 ——
      // 408- 仓库的 app/index.html 题库脚本就是坏的（`const QUESTIONS = []; int turn=0; …`
      // 直接被浏览器判 SyntaxError），加载它等于零题目。
      let mirrorStale = false;
      if (manualEntry) {
        console.info("[ProjectDetail] 站长手动上传过体验页 → 固定优先展示站内版本，仓库 raw 仅兜底");
      } else if (entry && rawDemoUrl && hasGhParts && project.gh_entry_path) {
        const [localSize, remoteMeta] = await Promise.all([
          mirroredSize(entry),
          fetchEntryMeta(ghOwner, ghRepo, ghRef, project.gh_entry_path),
        ]);
        if (localSize && remoteMeta && remoteMeta.size > 0) {
          const diff = Math.abs(remoteMeta.size - localSize) / remoteMeta.size;
          mirrorStale = diff > 0.02;
          console.info(
            `[ProjectDetail] 快照比对 站内=${localSize}B 仓库=${remoteMeta.size}B 差异=${(diff * 100).toFixed(1)}% → ${mirrorStale ? "改用仓库最新版" : "沿用站内快照"}`,
          );
        } else {
          console.info(`[ProjectDetail] 快照比对信息不足（站内=${localSize ?? "-"} 仓库=${remoteMeta?.size ?? "-"}），沿用站内快照`);
        }
      }

      // 顺序铁律（勿回退）：站内快照在前、仓库 raw 只兜底。
      // 历史上这里有一句 `if (manualEntry && !mirrorStale) steps.reverse()`，它把站长手动上传的
      // 版本挤到第二位，浏览器转而去加载仓库那份跑不起来的文件 —— 408- 的题目就是这么没的。
      const steps: Array<() => Promise<string>> = [];
      if (entry && !mirrorStale) steps.push(fromMirror);
      if (rawDemoUrl) steps.push(fromRaw);
      if (entry && mirrorStale) steps.push(fromMirror);
      console.info(
        `[ProjectDetail] 体验页尝试顺序 ${steps.map((s) => (s === fromMirror ? "站内快照" : "仓库raw")).join(" → ")}（手动上传=${manualEntry} 快照落后=${mirrorStale}）`,
      );
      let last: unknown = null;
      for (const step of steps) {
        try {
          const text = await step();
          console.info(`[ProjectDetail] 体验页加载完成 耗时=${Date.now() - t0}ms project=${project.id}`);
          show(text, step === fromMirror ? "mirror" : "raw");
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[ProjectDetail] 体验页加载失败，尝试下一个来源：${msg}`);
          last = e instanceof Error ? e : new Error(msg);
        }
      }
      throw last instanceof Error ? last : new Error("页面读取失败");
    };

    load().catch((e) => {
      if (cancelled) return;
      console.error(`[ProjectDetail] 体验页全部来源都失败 project=${project.id}：${e instanceof Error ? e.message : e}`);
      setDemoHtml(null);
      setDemoSource(null);
      setDemoState("error");
      setDemoError(
        editMode && isGithub
          ? "没能读到这个仓库的页面（当前网络可能访问不到 GitHub）。点下面的「上传 index.html」，把入口文件传一次即可长期在线体验。"
          : e instanceof Error ? e.message : "页面读取失败",
      );
    });
    return () => { cancelled = true; };
    // 只在「项目切换 / 首次进入可体验态」时拉取，不跟随 canExperience 的瞬时抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.entry_url, project?.demo_mode, canExperience, demoNonce, editMode, isGithub, rawDemoUrl]);

  // 站内体验 → 拉取后的 HTML 文本（走 srcDoc）；外部链接 → 原始地址直挂
  const experienceSrc = project?.demo_mode === "external" ? (project?.external_url ?? null) : null;

  // 兜底：仓库页面太大（云函数搬不动）或镜像缺失时，站长在编辑模式下直接上传一次 HTML。
  // 浏览器直传存储桶，不受网关超时限制；上传后 entry_url 变成完整站内地址，同步任务不会覆盖。
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const needManualUpload = isGithub && demoState === "error";

  /**
   * 把仓库里的最新版入口文件拉下来、存成站内快照。
   * 走浏览器端直传（不受云函数网关限制），成功后 entry_url 指向新快照并进锁定名单，
   * 之后的自动同步不会再覆盖它。这是「站内快照落后于仓库」时最省事的一条修法。
   */
  async function pullLatestFromRepo() {
    if (!project || !hasGhParts || !project.gh_entry_path) return;
    setPulling(true);
    try {
      const url = githubRawUrl(ghOwner, ghRepo, ghRef, project.gh_entry_path);
      console.info(`[ProjectDetail] 拉取仓库最新版 ${url}`);
      const text = await fetchHtmlText(url, 60_000);
      const file = new File([text], "index.html", { type: "text/html" });
      const result = await uploadSingleHtml(file, project.id);
      await patchProject(project.id, { entry_url: result.entryUrl, demo_mode: "inline" });
      setDemoNonce((n) => n + 1);
      toast.success(`站内快照已更新为仓库最新版（${Math.round(text.length / 1024)}KB）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ProjectDetail] 拉取仓库最新版失败：${msg}`);
      toast.error(msg || "拉取失败");
    } finally {
      setPulling(false);
    }
  }

  /**
   * 按当前项目内容生成一张统一风格的封面，直接写回 `projects.cover_url`。
   * `cover_url` 不在 github-sync 的同步负载里，所以存下来后不会被自动同步覆盖。
   */
  async function makeCover() {
    if (!project) return;
    setCoverBusy(true);
    try {
      const { url } = await generateCover({
        id: project.id,
        title: project.title,
        description: project.description,
        tags: project.tags,
        gh_language: project.gh_language ?? null,
      });
      await patchProject(project.id, { cover_url: url });
      toast.success("封面已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ProjectDetail] 生成封面失败：${msg}`);
      toast.error(msg || "生成封面失败");
    } finally {
      setCoverBusy(false);
    }
  }

  /**
   * 放大按钮：在**当前页面**把体验区铺满整屏，只留 HTML 页面本身（标题、标签、
   * 简介、选项卡全部收起），不新开标签页、也不换路由。
   * ⚠️ 不能用 window.open —— 站长要的是「把这个 HTML 放大」，不是再开一个带壳页面。
   */
  function toggleFullscreen() {
    const next = !fullscreen;
    console.info(`[ProjectDetail] 放大态切换 → ${next ? "整屏" : "还原"} project=${project?.id}`);
    setFullscreen(next);
  }

  async function handleDemoHtml(file: File | undefined) {
    if (!file || !project) return;
    if (!/\.html?$/i.test(file.name)) {
      toast.error("请选择 .html 文件");
      return;
    }
    if (file.size > MAX_SINGLE_FILE) {
      toast.error(`「${file.name}」超过单文件 ${formatBytes(MAX_SINGLE_FILE)} 上限`);
      return;
    }
    setUploading(true);
    try {
      const result = await uploadSingleHtml(file, project.id);
      await patchProject(project.id, { entry_url: result.entryUrl, demo_mode: "inline" });
      setDemoNonce((n) => n + 1);
      toast.success("体验页已就位，可直接在线玩");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (htmlInputRef.current) htmlInputRef.current.value = "";
    }
  }

  const source: SourceContent | null = useMemo(() => {
    if (hasGhParts) {
      return { kind: "github", owner: ghOwner, repo: ghRepo, ref: ghRef };
    }
    return project?.source_url ? { kind: "zip", url: project.source_url } : null;
  }, [hasGhParts, ghOwner, ghRepo, ghRef, project]);

  const tabs = useMemo(
    () =>
      [
        canExperience ? { id: "demo" as Tab, label: "在线体验", Icon: Rocket } : null,
        readmePath ? { id: "readme" as Tab, label: "文档", Icon: BookOpen } : null,
        hasSource ? { id: "source" as Tab, label: "源码", Icon: Code2 } : null,
      ].filter(Boolean) as Array<{ id: Tab; label: string; Icon: typeof Rocket }>,
    [canExperience, readmePath, hasSource],
  );

  // 默认落在「在线体验」，没有体验就退到文档或源码
  useEffect(() => {
    if (!project) return;
    setFullscreen(false);
    setTab(tabs[0]?.id ?? "demo");
  }, [project, tabs]);

  // README 内容按需取：GitHub 项目走代理实时读，zip 项目从源码包里取
  const readmeUrl = project?.source_url ?? "";
  useEffect(() => {
    let cancelled = false;
    setReadme(null);
    if (!project || !readmePath) { setReadmeState("idle"); return; }
    setReadmeState("loading");
    (async () => {
      try {
        let text: string;
        if (isGithub && hasGhParts) {
          text = await fetchReadme({ owner_login: ghOwner, name: ghRepo }, ghRef, readmePath);
        } else {
          if (!readmeUrl) throw new Error("源码包地址缺失");
          const res = await fetch(readmeUrl);
          if (!res.ok) throw new Error(`源码包读取失败 (${res.status})`);
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(await res.blob());
          const entry = zip.file(readmePath);
          if (!entry) throw new Error("源码包里找不到这份 README");
          text = await entry.async("string");
        }
        if (!cancelled) { setReadme({ path: readmePath, text }); setReadmeState("idle"); }
      } catch (e) {
        if (!cancelled) { setReadmeState("error"); setReadmeError(e instanceof Error ? e.message : "读取失败"); }
      }
    })();
    return () => { cancelled = true; };
  }, [project, readmePath, isGithub, hasGhParts, ghOwner, ghRepo, ghRef, readmeUrl]);

  // 打开某个项目时复位：收起放大态、锁定背景滚动。
  // ⚠️ 这个 effect **绝对不能**依赖 fullscreen：一旦依赖，点放大 → 本 effect 重跑 →
  // setFullscreen(false) 立刻把刚进去的整屏状态打回来，表现为「放大按钮点了没反应 / 打不开」。
  useEffect(() => {
    if (!project) return;
    setFullscreen(false);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [project]);

  // Esc 需要读到最新的 fullscreen，但又不能把它塞进依赖，用 ref 传递
  const fullscreenRef = useRef(false);
  useEffect(() => {
    fullscreenRef.current = fullscreen;
  }, [fullscreen]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fullscreenRef.current) setFullscreen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, onClose]);

  if (!project) return null;

  const usesExternal = project.demo_mode === "external";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] flex items-end justify-center bg-ink/35 p-0 backdrop-blur-md sm:items-center sm:p-6",
        // 放大态：整屏只剩页面本身，去掉遮罩虚化与四周留白
        fullscreen && "items-center bg-black p-0 backdrop-blur-none sm:p-0",
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "animate-pop-in relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-3xl bg-popover shadow-2xl ring-1 ring-white/50 sm:max-w-5xl sm:rounded-3xl",
          // ⚠️ 不能只写 sm:h-[92svh]：预览面板宽度常常不足 640px，那样切放大后画面几乎没变化
          fullscreen && "h-[100svh] max-h-none w-full max-w-none rounded-none shadow-none ring-0 sm:max-w-none sm:rounded-none",
        )}
      >
        {!fullscreen && <div className="rainbow-line h-1.5 w-full shrink-0" />}

        {/* 站长手动补体验页的隐藏输入：错误态与「空白提示」两处都要用，只放一份 */}
        <input
          ref={htmlInputRef}
          type="file"
          accept=".html,.htm"
          className="hidden"
          onChange={(e) => void handleDemoHtml(e.target.files?.[0])}
        />

        {/* 放大态：画面全部让给 HTML 本身，只留一组悬浮控制（Esc 也可退回弹窗） */}
        {fullscreen && (
          <div className="absolute right-3 top-3 z-20 flex items-center gap-0.5 rounded-pill bg-ink/55 p-1 backdrop-blur-sm">
            <button
              type="button"
              title="退出放大（Esc）"
              onClick={toggleFullscreen}
              className="rounded-full p-1.5 text-white/85 transition hover:bg-white/15 hover:text-white"
            >
              <Minimize2 size={16} />
            </button>
            <button
              type="button"
              title="关闭"
              onClick={onClose}
              className="rounded-full p-1.5 text-white/85 transition hover:bg-white/15 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className={cn("flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-7", fullscreen && "hidden")}>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 truncate font-display text-xl font-bold text-ink sm:text-2xl">
              {project.title}
              {isGithub && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-ink/85 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                  <Github size={10} /> 自动同步
                  {(project.gh_stars ?? 0) > 0 && (
                    <span className="ml-0.5 inline-flex items-center gap-0.5">
                      <Star size={9} className="text-butter" /> {project.gh_stars}
                    </span>
                  )}
                </span>
              )}
            </h3>
            {project.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {project.tags.map((t) => (
                  <span key={t} className="rounded-pill bg-lilac/12 px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-lilac">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tab === "demo" && canExperience && !fullscreen && (
              <AuroraButton variant="soft" size="iconSm" title="放大：只显示页面本身" onClick={toggleFullscreen}>
                <Maximize2 size={14} />
              </AuroraButton>
            )}
            {editMode && !fullscreen && (
              <AuroraButton
                variant="soft"
                size="iconSm"
                title="AI 生成封面（按项目内容画，统一画风）"
                disabled={coverBusy}
                onClick={() => void makeCover()}
              >
                {coverBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              </AuroraButton>
            )}
            {editMode && isGithub && hasGhParts && project.gh_entry_path && !fullscreen && (
              <AuroraButton
                variant="soft"
                size="iconSm"
                title="把仓库最新版存成站内快照"
                disabled={pulling}
                onClick={() => void pullLatestFromRepo()}
              >
                {pulling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </AuroraButton>
            )}
            {project.gh_html_url && (
              <AuroraLink href={project.gh_html_url} target="_blank" rel="noreferrer" variant="soft" size="iconSm" title="新标签页打开">
                <ExternalLink size={14} />
              </AuroraLink>
            )}
            {!isGithub && experienceSrc && (
              <AuroraLink href={experienceSrc} target="_blank" rel="noreferrer" variant="soft" size="iconSm" title="新标签页打开">
                <ExternalLink size={14} />
              </AuroraLink>
            )}
            <AuroraButton variant="ghost" size="iconSm" title="关闭" onClick={onClose}>
              <X size={16} />
            </AuroraButton>
          </div>
        </div>

        {!fullscreen && project.description && (
          <p className="shrink-0 px-5 pb-3 text-[13.5px] leading-relaxed text-ink-soft sm:px-7">{project.description}</p>
        )}

        {/* 选项卡 */}
        {!fullscreen && tabs.length > 0 && (
          <div className="shrink-0 px-5 sm:px-7">
            <div className="inline-flex gap-1 rounded-2xl bg-muted/55 p-1">
              {tabs.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-semibold transition-all",
                    tab === id ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
                  )}
                >
                  <Icon size={13} className={tab === id ? "text-lilac" : undefined} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={cn("flex-1 overflow-y-auto px-5 pb-6 pt-4 sm:px-7", fullscreen && "overflow-hidden p-0")}>
          {tab === "demo" && (
            canExperience ? (
              <>
                <div className={cn("relative overflow-hidden border-border/70 bg-white shadow-inner", fullscreen ? "h-full w-full border-0" : "h-[56vh] min-h-[340px] rounded-2xl border")}>
                  {experienceSrc ? (
                    <iframe
                      src={experienceSrc}
                      title={`${project.title} 在线体验`}
                      className="h-full w-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
                      allow="clipboard-read; clipboard-write; fullscreen; autoplay"
                      onLoad={() => setFrameReady(true)}
                    />
                  ) : demoHtml ? (
                    // srcDoc 继承父页面 origin，iframe 内 localStorage / IndexedDB 可用
                    <iframe
                      ref={demoFrameRef}
                      srcDoc={demoHtml}
                      title={`${project.title} 在线体验`}
                      className="h-full w-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
                      allow="clipboard-read; clipboard-write; fullscreen; autoplay"
                      onLoad={() => {
                        setFrameReady(true);
                        // 延迟复查一次 iframe 内容：纯白页面（开发态入口）不该被当成正常体验
                        window.setTimeout(() => {
                          if (!frameLooksEmpty(demoFrameRef.current)) return;
                          console.warn(`[ProjectDetail] 体验页渲染后仍为空白 project=${project.id} 来源=${demoSource ?? "-"}`);
                          setFrameEmpty(true);
                        }, 1500);
                      }}
                    />
                  ) : demoState === "error" ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                      <p className="text-sm font-semibold text-ink">
                        {needManualUpload && editMode ? "这个页面需要站长上传一次" : "体验页加载失败"}
                      </p>
                      <p className="max-w-md text-xs text-muted-foreground">{demoError}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
                        {needManualUpload && editMode && (
                          <>
                            <AuroraButton size="sm" variant="soft" disabled={uploading} onClick={() => htmlInputRef.current?.click()}>
                              <Upload size={13} /> {uploading ? "正在上传…" : "上传 index.html"}
                            </AuroraButton>
                            {hasGhParts && project.gh_entry_path && (
                              <AuroraButton size="sm" variant="glow" disabled={pulling} onClick={() => void pullLatestFromRepo()}>
                                {pulling ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                {pulling ? "正在拉取…" : "从仓库拉取最新版"}
                              </AuroraButton>
                            )}
                          </>
                        )}
                        <AuroraButton size="sm" variant="soft" onClick={() => setDemoNonce((n) => n + 1)}>
                          重试
                        </AuroraButton>
                        {project.gh_html_url && (
                          <a href={project.gh_html_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-lilac hover:underline">
                            去 GitHub 查看
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
                      <Loader2 size={22} className="animate-spin text-lilac" />
                      <p className="text-xs text-muted-foreground">正在拉取仓库里的页面…（首次加载较大，请稍候）</p>
                    </div>
                  )}

                  {/* 加载遮罩：拉取 + iframe 内部资源全部就绪前，不露出半成品页面 */}
                  {demoState === "loading" && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white/95 px-8 backdrop-blur-sm">
                      <Loader2 size={24} className="animate-spin text-lilac" />
                      <p className="text-sm font-semibold text-ink">正在加载体验页面…</p>
                      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-lilac/15">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-bubble),var(--color-lilac),var(--color-sky))] transition-[width] duration-300 ease-out"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">{progress}%</p>
                    </div>
                  )}
                </div>
                {!fullscreen && (
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    {demoSource === "raw"
                      ? `当前展示的是仓库 ${project.gh_entry_path} 的最新版（站内快照已落后，已自动切换）。`
                      : isGithub
                        ? `体验区运行的是仓库 ${project.gh_entry_path} 的站内快照，页面里的外部依赖（CDN 字体、KaTeX 等）需要联网。`
                        : "体验区运行在沙箱 iframe 中；若作品依赖外部网络资源，可能需要联网才能完整呈现。"}
                    {" "}想看得更完整，点右上角的放大按钮铺满整屏（Esc 退回）。
                  </p>
                )}
                {!fullscreen && frameEmpty && (
                  <div className="mt-2.5 flex flex-col gap-2 rounded-2xl border border-amber-300/70 bg-amber-50/85 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12px] leading-relaxed text-amber-900">
                      这个页面没有渲染出内容 —— 它的入口是<b>开发态源码</b>（要构建之后才能在浏览器里跑），单文件的站内在线体验跑不起来。
                      {editMode ? "站长可以上传构建好的 index.html。" : "可以先看看它的源码或文档。"}
                    </p>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {editMode && (
                        <AuroraButton size="sm" variant="soft" disabled={uploading} onClick={() => htmlInputRef.current?.click()}>
                          <Upload size={13} /> {uploading ? "上传中…" : "上传 index.html"}
                        </AuroraButton>
                      )}
                      {hasSource && (
                        <AuroraButton size="sm" variant="soft" onClick={() => setTab("source")}>
                          <Code2 size={13} /> 看源码
                        </AuroraButton>
                      )}
                      {project.gh_html_url && (
                        <a href={project.gh_html_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-lilac hover:underline">
                          去 GitHub 查看
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-lilac/25 bg-lilac/5 px-6 py-14 text-center">
                <Rocket size={26} className="text-lilac" />
                <p className="text-sm font-semibold text-ink">这个项目没有在线体验</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {usesExternal
                    ? "外部链接似乎还没配置好。"
                    : isGithub
                      ? "它是个源码工程，要构建之后才能跑起来，所以站内不做在线托管。切到「文档」看 README、「源码」浏览文件树，或者去 GitHub 直接看。"
                      : "它目前只提供源码与文档，切到上面的「文档」或「源码」看看。"}
                </p>
                {isGithub && !usesExternal && (
                  <a
                    href={project.gh_html_url ?? `https://github.com/${ghOwner}/${ghRepo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-lilac hover:underline"
                  >
                    <Github size={13} /> 去 GitHub 查看
                  </a>
                )}
              </div>
            )
          )}

          {tab === "readme" && (
            <div className="rounded-2xl bg-white/70 p-5 ring-1 ring-border/50 sm:p-8">
              {readmeState === "loading" && (
                <div className="space-y-3">
                  {[70, 92, 55, 80].map((w, i) => (
                    <div key={i} className="h-3.5 animate-pulse rounded-full bg-lilac/12" style={{ width: `${w}%` }} />
                  ))}
                  <p className="pt-2 text-center text-xs text-muted-foreground">{isGithub ? "正在读取 README…" : "正在从源码包里取出 README…"}</p>
                </div>
              )}
              {readmeState === "error" && (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-ink">README 读取失败</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">{readmeError}</p>
                  {project.source_url && (
                    <a href={project.source_url} download={project.source_name ?? undefined} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-lilac hover:underline">
                      <Download size={13} /> 改为下载源码包查看
                    </a>
                  )}
                </div>
              )}
              {readmeState === "idle" && readme && <MarkdownView source={readme.text} />}
              {readmeState === "idle" && !readme && (
                <p className="py-10 text-center text-sm text-muted-foreground">这份 README 暂时打不开，试试「源码」标签页。</p>
              )}
            </div>
          )}

          {tab === "source" && (
            <div className="space-y-4">
              {isGithub && hasGhParts && (
                <a
                  href={`https://github.com/${ghOwner}/${ghRepo}/archive/refs/heads/${project.default_branch ?? "main"}.zip`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm text-ink ring-1 ring-border/50 transition hover:bg-white hover:shadow-md"
                >
                  <span className="truncate font-medium">下载完整源码（GitHub zip）</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-lilac">
                    <Download size={13} /> {ghOwner}/{ghRepo}
                  </span>
                </a>
              )}
              {!isGithub && project.source_url && (
                <a
                  href={project.source_url}
                  download={project.source_name ?? undefined}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm text-ink ring-1 ring-border/50 transition hover:bg-white hover:shadow-md"
                >
                  <span className="truncate font-medium">{project.source_name || "source.zip"}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-lilac">
                    <Download size={13} /> 下载完整源码
                  </span>
                </a>
              )}
              <SourceBrowser entries={sourceEntries} source={source} />
              {project.files.length > 0 && (
                <div className="rounded-2xl bg-muted/45 p-4 sm:p-5">
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">构建产物文件</p>
                  <ul className="max-h-52 space-y-1 overflow-y-auto pr-1 font-mono text-[11.5px] text-ink-soft">
                    {project.files.map((f) => (
                      <li key={f.path} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 odd:bg-white/55">
                        <a href={f.url} target="_blank" rel="noreferrer" className="truncate transition hover:text-lilac hover:underline">
                          {f.path}
                        </a>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">{formatBytes(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
