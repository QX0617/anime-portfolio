import { useRef, useState } from "react";
import { FileArchive, FolderUp, TriangleAlert } from "lucide-react";
import type { ProjectFile } from "@/lib/types";
import { collectFilesFromZip, uploadBuildBundle, uploadSingleHtml } from "@/lib/project-upload";
import { formatBytes, MAX_SINGLE_FILE, MAX_TOTAL_SIZE } from "@/lib/storage";
import { AuroraButton } from "@/components/ui/aurora-button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** 与 ProjectEditor 的 Draft 共享的体验内容片段 */
export type DemoDraft = {
  entry_url: string | null;
  external_url: string | null;
  files: ProjectFile[];
};

const KINDS = [
  { value: "single", label: "单文件网页", desc: "一个 .html，样式脚本内联其中", github: true },
  { value: "zip", label: "构建产物 zip", desc: "zip 内需包含 index.html", github: false },
  { value: "files", label: "多文件产物", desc: "直接多选 index.html + assets", github: false },
  { value: "external", label: "外部链接", desc: "已有线上地址，填 URL 即可", github: true },
] as const;

type Kind = (typeof KINDS)[number]["value"];

/**
 * 「在线体验内容」编辑区，手动项目与 GitHub 同步项目共用：
 * - full：单文件 / 构建产物 zip / 多文件 / 外部链接（手动项目）
 * - github：只留单文件与外部链接（构建产物与源码由同步任务负责，不重复给入口）
 */
export function DemoContentEditor({
  variant,
  projectId,
  value,
  onChange,
}: {
  variant: "full" | "github";
  projectId: string;
  value: DemoDraft;
  onChange: (patch: Partial<DemoDraft>) => void;
}) {
  const kinds = variant === "github" ? KINDS.filter((k) => k.github) : KINDS;
  const [kind, setKind] = useState<Kind>(value.external_url ? "external" : "single");
  const [busy, setBusy] = useState("");
  const [warn, setWarn] = useState("");
  const zipRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const inputCls =
    "w-full rounded-xl border border-input bg-white/75 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-lilac/60 focus:ring-2 focus:ring-lilac/25";

  function validateSizes(files: { size: number; name?: string; path?: string }[]) {
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL_SIZE) {
      toast.error(`文件总量 ${formatBytes(total)} 超出 60MB 上限`);
      return false;
    }
    const oversize = files.find((f) => f.size > MAX_SINGLE_FILE);
    if (oversize) {
      toast.error(`「${oversize.name ?? oversize.path}」超过单文件 15MB 上限`);
      return false;
    }
    return true;
  }

  async function handleBuildZip(file: File | undefined) {
    if (!file) return;
    setWarn("");
    if (!validateSizes([{ size: file.size, name: file.name }])) return;
    setBusy("正在解压构建产物…");
    try {
      const unpacked = await collectFilesFromZip(file);
      if (unpacked.length === 0) throw new Error("zip 里没有可用文件");
      if (!validateSizes(unpacked)) return;
      const result = await uploadBuildBundle(unpacked, projectId);
      if (!result.hasEntry) {
        setWarn("未在 zip 中找到 index.html，无法作为体验页");
        return;
      }
      onChange({ entry_url: result.entryUrl, files: result.files, external_url: null });
      toast.success(`构建产物上传完成，共 ${result.files.length} 个文件`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解压上传失败");
    } finally {
      setBusy("");
      if (zipRef.current) zipRef.current.value = "";
    }
  }

  async function handleBuildFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setWarn("");
    if (!validateSizes(picked.map((f) => ({ size: f.size, name: f.name })))) return;
    setBusy(`正在上传 ${picked.length} 个文件…`);
    try {
      // ⚠️ webkitRelativePath 只在选中文件夹时才有值，单文件回退 name，
      // 否则相对目录结构全丢，体验页的资源会 404。
      const withPaths = picked.map((f) => ({
        path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/^\/+/, ""),
        blob: f,
        size: f.size,
      }));
      const result = await uploadBuildBundle(withPaths, projectId);
      if (!result.hasEntry) {
        setWarn("文件集合里没有 index.html，无法作为体验页");
        return;
      }
      onChange({ entry_url: result.entryUrl, files: result.files, external_url: null });
      toast.success(`已上传 ${result.files.length} 个文件`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
      if (filesRef.current) filesRef.current.value = "";
    }
  }

  async function handleSingleHtml(file: File | undefined) {
    if (!file) return;
    setWarn("");
    if (!/\.html?$/i.test(file.name)) {
      toast.error("请选择 .html 文件");
      return;
    }
    if (!validateSizes([{ size: file.size, name: file.name }])) return;
    setBusy("正在上传网页…");
    try {
      const result = await uploadSingleHtml(file, projectId);
      onChange({ entry_url: result.entryUrl, files: result.files, external_url: null });
      toast.success("网页已上传，可直接体验");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-2xl border border-lilac/20 bg-lilac/5 p-4">
      <p className="mb-3 text-xs font-semibold text-ink">在线体验内容</p>
      <div className={cn("grid gap-2", kinds.length > 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-left transition",
              kind === k.value ? "border-lilac bg-white shadow-sm" : "border-transparent bg-white/55 hover:bg-white",
            )}
          >
            <span className="block text-[13px] font-semibold text-ink">{k.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{k.desc}</span>
          </button>
        ))}
      </div>

      <div className="mt-3.5">
        {kind === "single" && (
          <DropZone busy={busy} onFile={handleSingleHtml} accept=".html,.htm" label="拖入或选择一个 .html 文件" hint="样式与脚本需内联在该文件里" />
        )}
        {kind === "zip" && (
          <DropZone busy={busy} onFile={handleBuildZip} accept=".zip" label="拖入或选择构建产物 zip" hint="zip 内须包含 index.html，会自动整理资源路径" refInput={zipRef} />
        )}
        {kind === "files" && (
          <div className="rounded-xl border-2 border-dashed border-lilac/30 bg-white/60 p-4 text-center">
            <p className="mb-3 text-xs text-muted-foreground">选择 index.html 及其 assets 等资源文件（可多选，或选择文件夹）</p>
            <div className="flex flex-wrap justify-center gap-2">
              <AuroraButton variant="soft" size="sm" onClick={() => filesRef.current?.click()}>
                <FolderUp size={13} /> 多选文件
              </AuroraButton>
              <AuroraButton variant="soft" size="sm" onClick={() => zipRef.current?.click()}>
                <FileArchive size={13} /> 改用 zip
              </AuroraButton>
            </div>
          </div>
        )}
        {kind === "external" && (
          <input
            className={inputCls}
            placeholder="https://your-demo.example.com"
            value={value.external_url ?? ""}
            onChange={(e) => onChange({ external_url: e.target.value || null })}
          />
        )}
      </div>

      {value.entry_url && kind !== "external" && (
        <p className="mt-2.5 text-[11px] text-emerald-700">
          ✓ 已就绪：{value.files.length} 个文件，入口 {value.entry_url.split("/").slice(-2).join("/")}
        </p>
      )}
      {warn && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-amber-700">
          <TriangleAlert size={13} className="mt-px shrink-0" /> {warn}
        </p>
      )}

      <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={(e) => void handleBuildZip(e.target.files?.[0])} />
      <input ref={filesRef} type="file" multiple className="hidden" onChange={(e) => void handleBuildFiles(e.target.files)} />
    </div>
  );
}

function DropZone({
  busy,
  onFile,
  accept,
  label,
  hint,
  refInput,
}: {
  busy: string;
  onFile: (f: File | undefined) => void;
  accept: string;
  label: string;
  hint?: string;
  refInput?: React.RefObject<HTMLInputElement | null>;
}) {
  const inner = useRef<HTMLInputElement>(null);
  const inputRef = refInput ?? inner;
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void onFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition",
        over ? "border-lilac bg-lilac/10" : "border-lilac/30 bg-white/60 hover:bg-white",
      )}
    >
      <p className="text-[13px] font-medium text-ink">{busy || label}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
