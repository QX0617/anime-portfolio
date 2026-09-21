import { ArrowUp } from "lucide-react";
import { useSite } from "@/lib/site-context";

export function SiteFooter() {
  const { settings } = useSite();
  return (
    <footer className="relative z-10 border-t border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <p>
          © {new Date().getFullYear()} {settings.username} · 用
          <span className="mx-1 text-bubble">♥</span>
          与 AI 造一些小玩意儿
        </p>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-lilac/10 hover:text-lilac"
        >
          <ArrowUp size={14} /> 回到顶部
        </button>
      </div>
    </footer>
  );
}
