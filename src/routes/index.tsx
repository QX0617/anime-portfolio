import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { SiteProvider, useSite } from "@/lib/site-context";
import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { ProjectsSection } from "@/components/ProjectsSection";
import { AboutSection } from "@/components/AboutSection";
import { ContactSection } from "@/components/ContactSection";
import { SiteFooter } from "@/components/SiteFooter";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { ThreeBackground } from "@/components/ThreeBackground";

export const Route = createFileRoute("/")({
  component: PortfolioPage,
});

function PortfolioPage() {
  return (
    <SiteProvider>
      <PortfolioShell />
    </SiteProvider>
  );
}

function PortfolioShell() {
  const { loading } = useSite();

  if (loading) {
    return (
      <div className="flex min-h-[100svh] flex-col items-center justify-center gap-3 aurora-bg">
        <Loader2 size={26} className="animate-spin text-lilac" />
        <p className="font-display text-sm font-semibold tracking-wide text-ink-soft">正在打开展览厅…</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100svh]">
      {/* 页面级 3D 流光层：铺在区块背景之上、正文之下，见 components/ThreeBackground.tsx */}
      <ThreeBackground />
      <Navbar />
      <main>
        <HeroSection />
        <ProjectsSection />
        <AboutSection />
        <ContactSection />
      </main>
      <SiteFooter />
      <SettingsDrawer />
    </div>
  );
}
