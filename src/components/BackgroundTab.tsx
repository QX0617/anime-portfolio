import { useState } from "react";
import { Layers, RotateCcw } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { DEFAULT_BACKGROUNDS, type BackgroundConfig, type SectionKey } from "@/lib/types";
import { ImageUploader } from "@/components/ImageUploader";
import { Switch } from "@/components/ui/switch";
import { setThreeBgEnabled, useThreeBgEnabled } from "@/lib/bg3d";
import { AuroraButton } from "@/components/ui/aurora-button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SECTIONS: { key: SectionKey; label: string; desc: string }[] = [
  { key: "site", label: "整站背景", desc: "作为各区块「跟随整站」时的底" },
  { key: "hero", label: "首屏 Hero", desc: "头像与用户名所在的第一屏" },
  { key: "projects", label: "作品陈列室", desc: "项目卡片网格区域" },
  { key: "about", label: "关于我", desc: "自我介绍卡片区域" },
  { key: "contact", label: "联系方式", desc: "页尾联系区块" },
];

export function BackgroundTab() {
  const { settings, saveSettings } = useSite();
  const [active, setActive] = useState<SectionKey>("hero");
  const [draft, setDraft] = useState<BackgroundConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const bg3d = useThreeBgEnabled();

  const current: BackgroundConfig = draft ?? settings.backgrounds[active] ?? DEFAULT_BACKGROUNDS[active];

  function pick(key: SectionKey) {
    setActive(key);
    setDraft(null);
  }

  function patch(p: Partial<BackgroundConfig>) {
    setDraft({ ...current, ...p });
  }

  async function persist(next: BackgroundConfig) {
    setSaving(true);
    try {
      await saveSettings({ backgrounds: { ...settings.backgrounds, [active]: next } });
      setDraft(next);
      toast.success("背景已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function restoreDefault() {
    await persist(DEFAULT_BACKGROUNDS[active]);
  }

  return (
    <div className="space-y-5">
      {/* 3D 流光层是页面级的：叠在各区块背景之上而不是替换它，所以单独放在最上面 */}
      <div className="flex items-start justify-between gap-3 rounded-2xl bg-muted/40 p-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-soft">3D 动效背景</p>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            页面级 3D 星海（three.js）叠在下方背景之上：带星芒的亮星、清晰的线框几何体、有边界的星云与极光带、拖着尾巴的流星，随上下滑动向前穿越并无限循环，鼠标移动带出视差。关闭后回到纯 CSS 炫彩渐变，更省电。
          </p>
        </div>
        <Switch checked={bg3d} onCheckedChange={setThreeBgEnabled} aria-label="3D 动效背景" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => pick(s.key)}
            className={cn(
              "rounded-pill px-3.5 py-1.5 text-xs font-semibold transition",
              active === s.key ? "bg-ink text-white shadow-md" : "bg-muted/70 text-ink-soft hover:bg-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">{SECTIONS.find((s) => s.key === active)?.desc}</p>

      <div className="grid grid-cols-3 gap-2">
        {(["image", "gradient", "inherit"] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={active === "site" && m === "inherit"}
            onClick={() => void patch({ mode: m })}
            className={cn(
              "rounded-xl border px-2 py-2.5 text-xs font-semibold transition disabled:opacity-40",
              current.mode === m ? "border-lilac bg-lilac/10 text-lilac" : "border-border/70 bg-white/70 text-ink-soft hover:border-lilac/40",
            )}
          >
            {m === "image" ? "上传图片" : m === "gradient" ? "炫彩渐变" : "跟随整站"}
          </button>
        ))}
      </div>

      {current.mode === "image" && (
        <ImageUploader
          label="背景图片"
          value={current.url ?? null}
          onChange={(url) => void (url ? persist({ ...current, url }) : patch({ url: undefined }))}
          aspect="16 / 9"
          hint="建议宽幅大图，会自动裁剪铺满；上传后立即生效"
        />
      )}

      {current.mode !== "gradient" && (
        <div className="space-y-4 rounded-2xl bg-muted/40 p-4">
          <Slider label="遮罩浓度" value={current.overlay} min={0} max={85} onChange={(v) => patch({ overlay: v })} suffix="%" hint="越高文字越清晰" />
          <Slider label="背景模糊" value={current.blur} min={0} max={20} onChange={(v) => patch({ blur: v })} suffix="px" />
        </div>
      )}

      <div className="flex gap-2">
        {draft && (
          <AuroraButton variant="glow" size="md" className="flex-1" disabled={saving} onClick={() => void persist(current)}>
            {saving ? "应用中…" : "应用背景"}
          </AuroraButton>
        )}
        <AuroraButton variant="soft" size="md" disabled={saving} onClick={() => void restoreDefault()} title="恢复默认背景">
          <RotateCcw size={14} /> 恢复默认
        </AuroraButton>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-sky/8 p-3 text-[11px] leading-relaxed text-sky">
        <Layers size={13} className="mt-0.5 shrink-0" />
        提示：图片模式会自动叠加柔光遮罩，保证标题与正文在任何背景图上都能读清楚。
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="font-mono text-muted-foreground">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-lilac/25 accent-[var(--color-lilac)]"
      />
      {hint && <p className="mt-1 text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
