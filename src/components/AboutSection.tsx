import { useSite } from "@/lib/site-context";
import { SectionBackground } from "@/components/SectionBackground";
import { EditTag, EditZone } from "@/components/EditOverlay";

export function AboutSection() {
  const { settings, openSettings } = useSite();

  return (
    <EditZone>
      <section id="about" className="relative overflow-hidden py-24 sm:py-32">
        <SectionBackground section="about" />
        <div className="relative z-10 mx-auto max-w-4xl px-6">
          <div className="reveal glass-card rounded-3xl p-8 sm:p-12">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-lilac">maker · tinkerer · contributor</p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              关于<span className="aurora-text">我</span>
            </h2>
            <div className="rainbow-line mt-5 h-1 w-20 rounded-full opacity-70" />
            <div className="mt-7 space-y-4 text-[15px] leading-[1.9] text-ink-soft sm:text-base">
              {settings.bio ? (
                settings.bio.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)
              ) : (
                <p className="text-muted-foreground">
                  还没有写下自我介绍 —— 站长可以在设置里补充一段。
                </p>
              )}
            </div>
          </div>
        </div>
        <EditTag label="编辑简介" onClick={() => openSettings("profile")} />
      </section>
    </EditZone>
  );
}
