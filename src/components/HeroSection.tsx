import { ArrowDown, Sparkle } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { DEFAULT_AVATAR } from "@/lib/types";
import { SectionBackground } from "@/components/SectionBackground";
import { EditTag, EditZone } from "@/components/EditOverlay";
import { AuroraLink } from "@/components/ui/aurora-button";

export function HeroSection() {
  const { settings, openSettings } = useSite();

  return (
    <EditZone>
      <section id="hero" className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
        <SectionBackground section="hero" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-6 pb-24 pt-32 text-center">
          <div className="reveal-zoom reveal relative mb-8">
            <span className="absolute -inset-6 rounded-full bg-[conic-gradient(from_140deg,var(--color-bubble),var(--color-lilac),var(--color-sky),var(--color-mint),var(--color-bubble))] opacity-45 blur-2xl" />
            <span className="absolute -inset-2 animate-[spin_14s_linear_infinite] rounded-full border-2 border-dashed border-white/60" />
            <img
              src={settings.avatar_url ?? DEFAULT_AVATAR}
              alt={settings.username}
              className="relative h-28 w-28 rounded-full object-cover shadow-2xl shadow-lilac/30 ring-4 ring-white/85 sm:h-32 sm:w-32"
            />
          </div>

          <p className="reveal mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/60 px-4 py-1.5 text-xs font-semibold tracking-wide text-lilac shadow-sm backdrop-blur">
            <Sparkle size={13} className="fill-lilac text-lilac" />
            PORTFOLIO · AI 玩具与开源手记
          </p>

          <h1 className="reveal reveal-up font-display text-[clamp(2.4rem,8vw,4.6rem)] font-extrabold leading-[1.05] tracking-tight text-ink">
            <span className="aurora-text">{settings.username}</span>
          </h1>

          <p className="reveal reveal-up mt-5 max-w-xl text-balance text-base leading-relaxed text-ink-soft sm:text-lg" data-reveal-delay="120">
            {settings.tagline}
          </p>

          {settings.social_links.length > 0 && (
            <div className="reveal reveal-up mt-8 flex flex-wrap items-center justify-center gap-2.5" data-reveal-delay="220">
              {settings.social_links.map((link) => (
                <AuroraLink
                  key={link.label + link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  variant="soft"
                  size="sm"
                  className="!rounded-pill px-4"
                >
                  {link.label}
                </AuroraLink>
              ))}
            </div>
          )}

          <a
            href="#works"
            className="reveal mt-14 inline-flex flex-col items-center gap-1.5 text-xs font-medium tracking-[0.2em] text-ink-soft/70 transition hover:text-lilac"
          >
            向下探索
            <ArrowDown size={15} className="animate-bounce" />
          </a>
        </div>

        <EditTag label="编辑资料" onClick={() => openSettings("profile")} />
      </section>
    </EditZone>
  );
}
