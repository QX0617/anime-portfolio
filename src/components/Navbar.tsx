import { useEffect, useState } from "react";
import { Lock, Settings2, Sparkles } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { DEFAULT_AVATAR } from "@/lib/types";
import { AuroraButton } from "@/components/ui/aurora-button";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "works", label: "小玩意儿" },
  { id: "about", label: "关于我" },
  { id: "contact", label: "找我聊聊" },
];

export function Navbar() {
  const { settings, editMode, lock, openSettings } = useSite();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of ["hero", ...NAV.map((n) => n.id)]) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex justify-center px-4 transition-all duration-500",
        scrolled ? "pt-3" : "pt-5",
      )}
    >
      <nav
        className={cn(
          "flex w-full max-w-6xl items-center justify-between gap-3 rounded-3xl px-3 py-2.5 transition-all duration-500 sm:px-4",
          scrolled ? "glass-card shadow-xl shadow-lilac/10" : "bg-transparent",
        )}
      >
        <a href="#hero" className="group flex min-w-0 items-center gap-2.5">
          <span className="relative shrink-0">
            <img
              src={settings.avatar_url ?? DEFAULT_AVATAR}
              alt={settings.username}
              className="h-9 w-9 rounded-full object-cover ring-2 ring-white/80"
            />
            <span className="absolute -inset-1 rounded-full bg-[radial-gradient(circle,var(--color-bubble)_0%,transparent_70%)] opacity-0 blur-md transition group-hover:opacity-60" />
          </span>
          <span className="truncate font-display text-[15px] font-bold tracking-tight text-ink">
            {settings.username}
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-active={active === item.id}
              className="story-link text-sm font-medium text-ink-soft transition-colors hover:text-ink data-[active=true]:text-lilac"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {editMode && (
            <AuroraButton variant="soft" size="sm" onClick={lock} title="退出编辑模式">
              <Lock size={13} />
              <span className="hidden sm:inline">退出编辑</span>
            </AuroraButton>
          )}
          <AuroraButton variant={editMode ? "glow" : "soft"} size="sm" onClick={() => openSettings()}>
            <Settings2 size={14} />
            <span className="hidden sm:inline">{editMode ? "设置" : "站长入口"}</span>
          </AuroraButton>
        </div>
      </nav>

      {editMode && (
        <span className="pointer-events-none absolute -bottom-6 right-6 hidden items-center gap-1.5 rounded-full bg-lilac/85 px-3 py-1 text-[11px] font-semibold text-white shadow-lg shadow-lilac/30 backdrop-blur md:inline-flex">
          <Sparkles size={11} /> 编辑模式进行中
        </span>
      )}
    </header>
  );
}
