import { useSite } from "@/lib/site-context";
import type { SectionKey } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 区块背景层：支持内置炫彩渐变 / 上传图片 / 跟随整站背景，带遮罩与模糊。
 * 必须放在 `relative` 容器内，内容需在其上层（自行加 relative z-10）。
 */
export function SectionBackground({ section, className }: { section: SectionKey; className?: string }) {
  const { bgFor } = useSite();
  const cfg = bgFor(section);
  const siteCfg = bgFor("site");
  const resolved = cfg.mode === "inherit" ? { ...siteCfg, mode: siteCfg.mode } : cfg;

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {resolved.mode === "image" && resolved.url ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center will-change-transform"
            style={{
              backgroundImage: `url("${resolved.url}")`,
              filter: resolved.blur ? `blur(${resolved.blur}px)` : undefined,
              transform: resolved.blur ? `scale(${1 + resolved.blur / 60})` : undefined,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgba(255,252,255,${resolved.overlay / 100}) 0%, rgba(250,244,255,${
                resolved.overlay / 100
              }) 55%, rgba(255,246,250,${Math.min(0.95, resolved.overlay / 100 + 0.12)}))`,
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 aurora-bg" />
      )}
      <div className="absolute inset-0 sparkle-field opacity-70" />
      <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-lilac/25 blur-3xl animate-float-blob" />
      <div
        className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-bubble/20 blur-3xl animate-float-blob"
        style={{ animationDelay: "-6s" }}
      />
    </div>
  );
}
