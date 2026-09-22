import { Mail, MessageCircleHeart } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { SectionBackground } from "@/components/SectionBackground";
import { EditTag, EditZone } from "@/components/EditOverlay";
import { AuroraLink } from "@/components/ui/aurora-button";

export function ContactSection() {
  const { settings, openSettings } = useSite();

  return (
    <EditZone>
      <section id="contact" className="relative overflow-hidden py-24 sm:py-32">
        <SectionBackground section="contact" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <p className="reveal font-mono text-xs uppercase tracking-[0.3em] text-night-label">contact</p>
          <h2 className="reveal reveal-up mt-4 font-display text-3xl font-bold tracking-tight text-night-ink sm:text-[2.6rem]">
            一起做点<span className="aurora-text">温柔又炫酷</span>的东西
          </h2>
          <p className="reveal reveal-up mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-night-ink-soft" data-reveal-delay="120">
            有个好玩的 AI 点子想落地？开源项目里卡了个 bug 想找人一起看？还是只想聊聊某个实现思路——都欢迎随时找我。
          </p>

          <div className="reveal reveal-up mt-10 flex flex-wrap items-center justify-center gap-3" data-reveal-delay="200">
            {settings.social_links.length === 0 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-ink/85 px-5 py-2.5 text-sm text-night-ink-soft ring-1 ring-white/15 backdrop-blur">
                <MessageCircleHeart size={15} />
                站长还没有留下联系方式
              </span>
            )}
            {settings.social_links.map((link) => (
              <AuroraLink
                key={link.label + link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                variant={link.label.includes("邮") || link.url.startsWith("mailto:") ? "glow" : "soft"}
                size="md"
              >
                {link.url.startsWith("mailto:") && <Mail size={15} />}
                {link.label}
              </AuroraLink>
            ))}
          </div>
        </div>
        <EditTag label="编辑联系方式" onClick={() => openSettings("profile")} />
      </section>
    </EditZone>
  );
}
