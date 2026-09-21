import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { ChevronRight, FileCode2, FileText, FolderClosed, Image as ImageIcon, Loader2, Package, Search } from "lucide-react";
import type { SourceFileEntry, TreeEntry } from "@/lib/types";
import { fetchBlob, fetchTree } from "@/lib/github";
import { formatBytes } from "@/lib/storage";
import { MarkdownView } from "@/lib/markdown";
import { cn } from "@/lib/utils";

const MAX_PREVIEW = 512 * 1024;

/** 内容来源：站内 zip 源码包，或 GitHub 仓库实时读取 */
export type SourceContent =
  | { kind: "zip"; url: string }
  | { kind: "github"; owner: string; repo: string; ref: string };

type TreeNode = {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: SourceFileEntry;
};

function buildTree(entries: SourceFileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const entry of entries) {
    const segs = entry.path.split("/").filter(Boolean);
    let node = root;
    segs.forEach((seg, i) => {
      const isLeaf = i === segs.length - 1;
      let next = node.children.get(seg);
      if (!next) {
        next = { name: seg, path: isLeaf ? entry.path : segs.slice(0, i + 1).join("/"), children: new Map() };
        node.children.set(seg, next);
      }
      if (isLeaf) next.file = entry;
      node = next;
    });
  }
  return sortNodes(root);
}

function sortNodes(node: TreeNode): TreeNode[] {
  return [...node.children.values()]
    .sort((a, b) => {
      const aDir = a.children.size > 0 ? 0 : 1;
      const bDir = b.children.size > 0 ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name, undefined, { numeric: true });
    })
    .map((n) => (n.children.size > 0 ? { ...n, children: new Map(sortNodes(n).map((c) => [c.name, c])) } : n));
}

/** zip 内公共根目录（如 myproject-main/），展示时剥掉更清爽 */
function commonRoot(entries: SourceFileEntry[]): string {
  if (entries.length === 0) return "";
  const first = entries[0].path.split("/")[0];
  if (entries.length < 2) return "";
  return entries.every((e) => e.path.startsWith(`${first}/`)) ? `${first}/` : "";
}

function iconFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown" || ext === "txt") return FileText;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif"].includes(ext)) return ImageIcon;
  if (["zip", "tar", "gz", "7z"].includes(ext)) return Package;
  return FileCode2;
}

function isBinary(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "pdf", "zip", "tar", "gz", "7z", "wasm", "eot"].includes(ext);
}

export function SourceBrowser({ entries: initialEntries, source }: { entries: SourceFileEntry[]; source: SourceContent | null }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  // 早期项目只存了 zip、没归档文件树：现场解析一次补上
  const [derived, setDerived] = useState<SourceFileEntry[] | null>(null);
  const [deriving, setDeriving] = useState(false);
  // GitHub 来源：懒加载的一层目录（path -> entries）
  const [ghDirs, setGhDirs] = useState<Record<string, TreeEntry[]>>({});
  const [ghLoadingDir, setGhLoadingDir] = useState<string | null>(null);

  const isGithub = source?.kind === "github";

  useEffect(() => {
    if (initialEntries.length > 0 || source?.kind !== "zip" || derived) return;
    let cancelled = false;
    setDeriving(true);
    loadZip(source.url)
      .then((zip) => {
        if (cancelled) return;
        const list: SourceFileEntry[] = [];
        zip.forEach((rawPath, entry) => {
          if (entry.dir) return;
          const path = rawPath.replace(/^\/+/, "");
          if (!path) return;
          const meta = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
          list.push({ path, size: meta?.uncompressedSize ?? 0 });
        });
        setDerived(list.sort((a, b) => a.path.localeCompare(b.path)));
      })
      .catch(() => { if (!cancelled) setDerived([]); })
      .finally(() => { if (!cancelled) setDeriving(false); });
    return () => { cancelled = true; };
  }, [initialEntries.length, source, derived]);

  /** GitHub 仓库：展开某目录时拉一层 */
  async function ensureDir(dirPath: string) {
    if (!isGithub || ghDirs[dirPath]) return;
    setGhLoadingDir(dirPath);
    try {
      const list = await fetchTree(source.owner, source.repo, source.ref, dirPath || null);
      setGhDirs((prev) => ({ ...prev, [dirPath]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取目录失败");
    } finally {
      setGhLoadingDir(null);
    }
  }

  const entries = initialEntries.length > 0 ? initialEntries : (derived ?? []);

  // GitHub 仓库：进入即拉根目录（依赖用稳定的原始值，避免每帧重发请求）
  const ghOwner = source?.kind === "github" ? source.owner : "";
  const ghRepo = source?.kind === "github" ? source.repo : "";
  const ghRef = source?.kind === "github" ? source.ref : "";
  useEffect(() => {
    if (source?.kind !== "github") return;
    let cancelled = false;
    setGhLoadingDir("");
    fetchTree(ghOwner, ghRepo, ghRef, null)
      .then((list) => {
        if (cancelled) return;
        setGhDirs((prev) => ({ ...prev, "": list }));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "读取目录失败");
      })
      .finally(() => {
        if (!cancelled) setGhLoadingDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source?.kind, ghOwner, ghRepo, ghRef]);

  // zip 内公共根目录（如 myproject-main/），展示时剥掉更清爽
  const prefix = useMemo(() => commonRoot(entries), [entries]);
  const tree = useMemo(() => buildTree(entries.map((e) => ({ ...e, path: e.path.slice(prefix.length) }))), [entries, prefix]);
  const filtered = query.trim()
    ? entries.filter((e) => e.path.toLowerCase().includes(query.trim().toLowerCase()))
    : null;

  const selectedEntry = entries.find((e) => e.path.slice(prefix.length) === selected) ?? null;

  async function openFile(relPath: string) {
    setSelected(relPath);
    setContent(null);
    setError(null);
    if (isGithub) {
      setLoading(true);
      try {
        const text = await fetchBlob(source.owner, source.repo, source.ref, relPath);
        setContent(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "读取文件失败");
      } finally {
        setLoading(false);
      }
      return;
    }
    const entry = entries.find((e) => e.path.slice(prefix.length) === relPath);
    if (!entry) return;
    if (!source) { setError("源码包地址缺失，无法在线读取内容"); return; }
    if (entry.size > MAX_PREVIEW) { setError(`文件较大（${formatBytes(entry.size)}），暂不在线预览，请下载后查看`); return; }
    if (isBinary(entry.path)) { setError("这是二进制文件，不支持文本预览"); return; }
    setLoading(true);
    try {
      const zip = await loadZip(source.url);
      const target = zip.file(entry.path);
      if (!target) { setError("在源码包里找不到这个文件"); return; }
      setContent(await target.async("string"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取源码包失败");
    } finally {
      setLoading(false);
    }
  }

  function toggle(dir: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });
  }

  if (entries.length === 0 && !isGithub) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-lilac/25 bg-white/40 px-6 py-14 text-center">
        <Package size={24} className="text-lilac" />
        <p className="text-sm font-semibold text-ink">这个项目还没有上传源码包</p>
        <p className="max-w-sm text-xs text-muted-foreground">上传源代码 zip 之后，就能在这里展开文件树、逐个查看代码与 README。</p>
      </div>
    );
  }

  // GitHub 仓库：单层懒加载目录树（根目录已由上方 effect 拉取）
  if (isGithub) {
    const rootList = ghDirs[""] ?? [];
    return (
      <div className="grid overflow-hidden rounded-2xl ring-1 ring-border/60 lg:grid-cols-[minmax(0,17rem)_1fr]">
        <aside className="flex max-h-[62vh] min-w-0 flex-col border-b border-border/60 bg-white/55 lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {rootList.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin text-lilac" /> 正在读取仓库目录…
              </div>
            ) : (
              <GhTree list={rootList} depth={0} dirs={ghDirs} collapsed={collapsed} selected={selected} loadingDir={ghLoadingDir} onExpand={(p) => { void ensureDir(p); toggle(p); }} onToggle={toggle} onOpen={(p) => void openFile(p)} />
            )}
          </div>
          <p className="shrink-0 border-t border-border/50 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
            实时读取 · {source.repo}@{source.ref}
          </p>
        </aside>
        <SourcePane selected={selected} size={null} loading={loading} error={error} content={content} />
      </div>
    );
  }

  return (
    <div className="grid overflow-hidden rounded-2xl ring-1 ring-border/60 lg:grid-cols-[minmax(0,17rem)_1fr]">
      {/* 左：文件树 */}
      <aside className="flex max-h-[62vh] min-w-0 flex-col border-b border-border/60 bg-white/55 lg:max-h-none lg:border-b-0 lg:border-r">
        <div className="relative shrink-0 border-b border-border/50 p-2.5">
          <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件…"
            className="w-full rounded-xl bg-white/85 py-1.5 pl-8 pr-3 font-mono text-[12px] text-ink outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:ring-lilac/50"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered ? (
            <ul className="space-y-0.5">
              {filtered.slice(0, 200).map((e) => {
                const rel = e.path.slice(prefix.length);
                const Icon = iconFor(rel);
                return (
                  <li key={e.path}>
                    <button type="button" onClick={() => void openFile(rel)} className={rowCls(selected === rel)}>
                      <Icon size={13} className="shrink-0 text-lilac" />
                      <span className="truncate">{rel}</span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配的文件</li>}
            </ul>
          ) : (
            <TreeList nodes={tree} depth={0} collapsed={collapsed} onToggle={toggle} selected={selected} onOpen={(p) => void openFile(p)} />
          )}
        </div>
        <p className="shrink-0 border-t border-border/50 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
          {entries.length} 个文件 · {formatBytes(entries.reduce((s, e) => s + e.size, 0))}
        </p>
      </aside>

      {/* 右：内容 */}
      <SourcePane selected={selected} size={selectedEntry?.size ?? null} loading={loading} error={error} content={content} />
    </div>
  );
}

/** 右侧内容面板：zip / GitHub 两种来源共用 */
function SourcePane({ selected, size, loading, error, content }: {
  selected: string | null;
  size: number | null;
  loading: boolean;
  error: string | null;
  content: string | null;
}) {
  return (
    <section className="flex min-h-[340px] min-w-0 max-h-[62vh] flex-col bg-white/70 lg:max-h-[62vh]">
      {!selected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <FileCode2 size={22} className="text-lilac/70" />
          <p className="text-sm text-muted-foreground">从左侧选一个文件开始阅读</p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5">
            <span className="truncate font-mono text-[12px] text-ink">{selected}</span>
            {size !== null && <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{formatBytes(size)}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin text-lilac" /> 正在读取文件…
              </div>
            )}
            {!loading && error && <div className="p-6 text-center text-[13px] text-muted-foreground">{error}</div>}
            {!loading && !error && content !== null && (
              /\.(md|markdown)$/i.test(selected) ? (
                <div className="p-5 sm:p-7"><MarkdownView source={content} /></div>
              ) : (
                <pre className="p-4 font-mono text-[12.5px] leading-[1.7] text-ink">
                  {content.split("\n").map((line, i) => (
                    <span key={i} className="flex hover:bg-lilac/[0.06]">
                      <span className="sticky left-0 w-11 shrink-0 select-none bg-white/85 pr-3 text-right text-[11px] text-muted-foreground/70">{i + 1}</span>
                      <span className="whitespace-pre-wrap break-all">{line || " "}</span>
                    </span>
                  ))}
                </pre>
              )
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** GitHub 单层懒加载目录树 */
function GhTree({ list, depth, dirs, collapsed, selected, loadingDir, onExpand, onToggle, onOpen }: {
  list: TreeEntry[];
  depth: number;
  dirs: Record<string, TreeEntry[]>;
  collapsed: Set<string>;
  selected: string | null;
  loadingDir: string | null;
  onExpand: (path: string) => void;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {list.map((e) => {
        const isDir = e.type === "dir";
        const isOpen = !collapsed.has(e.path);
        const Icon = isDir ? FolderClosed : iconFor(e.name);
        return (
          <li key={e.path}>
            <button
              type="button"
              onClick={() => (isDir ? onExpand(e.path) : onOpen(e.path))}
              className={rowCls(!isDir && selected === e.path)}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {isDir ? (
                <ChevronRight size={12} className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <Icon size={13} className={cn("shrink-0", isDir ? "text-sky" : "text-lilac")} />
              <span className="truncate">{e.name}</span>
              {isDir && loadingDir === e.path && <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-muted-foreground" />}
              {!isDir && e.size > 0 && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/80">{formatBytes(e.size)}</span>}
            </button>
            {isDir && isOpen && dirs[e.path] && (
              <GhTree list={dirs[e.path]} depth={depth + 1} dirs={dirs} collapsed={collapsed} selected={selected} loadingDir={loadingDir} onExpand={onExpand} onToggle={onToggle} onOpen={onOpen} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function rowCls(active: boolean) {
  return cn(
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-[11.5px] transition",
    active ? "bg-lilac/15 text-ink" : "text-ink-soft hover:bg-lilac/[0.09] hover:text-ink",
  );
}

function TreeList({ nodes, depth, collapsed, onToggle, selected, onOpen }: {
  nodes: TreeNode[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isDir = node.children.size > 0;
        const isOpen = !collapsed.has(node.path);
        const Icon = isDir ? FolderClosed : iconFor(node.name);
        return (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
              className={cn(rowCls(!isDir && selected === node.path))}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {isDir ? (
                <ChevronRight size={12} className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <Icon size={13} className={cn("shrink-0", isDir ? "text-sky" : "text-lilac")} />
              <span className="truncate">{node.name}</span>
              {node.file && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/80">{formatBytes(node.file.size)}</span>}
            </button>
            {isDir && isOpen && (
              <TreeList nodes={[...node.children.values()].sort((a, b) => (a.children.size > 0 ? 0 : 1) - (b.children.size > 0 ? 0 : 1) || a.name.localeCompare(b.name))} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} selected={selected} onOpen={onOpen} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

let zipCache: { url: string; promise: Promise<JSZip> } | null = null;

/** 同一个源码包只下载解析一次，后续点文件直接命中缓存 */
function loadZip(url: string): Promise<JSZip> {
  if (zipCache?.url === url) return zipCache.promise;
  const promise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`源码包下载失败 (${r.status})`);
      return r.blob();
    })
    .then((b) => JSZip.loadAsync(b));
  zipCache = { url, promise };
  return promise;
}
