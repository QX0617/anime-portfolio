import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  /** CSS aspect-ratio，如 "16 / 9" */
  aspect?: string;
  hint?: string;
  className?: string;
};

export function ImageUploader({ label, value, onChange, aspect = "16 / 9", hint, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("图片请控制在 8MB 以内");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const { url } = await uploadFile(`images/${Date.now().toString(36)}.${ext}`, file);
      onChange(url);
      toast.success(`${label}已更新`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-semibold tracking-wide text-ink-soft">{label}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative flex w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-lilac/35 bg-lilac/5 transition hover:border-lilac/60 hover:bg-lilac/10",
          value && "border-solid",
        )}
        style={{ aspectRatio: aspect }}
      >
        {value ? (
          <img src={value} alt={label} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            {busy ? <Loader2 size={20} className="animate-spin text-lilac" /> : <ImagePlus size={20} className="text-lilac" />}
            点击上传图片
          </span>
        )}
        {value && !busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/40 text-xs font-semibold text-white opacity-0 backdrop-blur-[2px] transition group-hover:opacity-100">
            点击更换
          </span>
        )}
      </button>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-destructive/80 transition hover:text-destructive"
        >
          <Trash2 size={12} /> 移除图片
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
    </div>
  );
}
