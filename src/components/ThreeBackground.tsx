// 首屏 3D 夜空（three.js / WebGL）
//
// 设计约束（勿改）：
// 1) **它是 hero 的一层背景，不是视口贴片**：absolute inset-0 z-[1]，由 HeroSection 挂载，
//    跟着首屏一起滚走。之前做成 fixed 铺满视口，结果是任何文字滚过顶部暗带都会被压暗到
//    不满足对比度（实测 tagline 最坏 1.69:1）；「天空属于首屏」才是自洽的做法。
// 2) 压在区块背景（SectionBackground，z-auto）之上、正文（z-10）之下，
//    各区块原有图片 / CSS 炫彩渐变不受影响。
// 3) 任何环节失败（three 加载失败、WebGL 不可用、上下文丢失）都只移除自己，
//    页面立刻回到 CSS 炫彩渐变，绝不出现白屏或黑块。黄昏底也一起撤掉，不留残色。
// 4) 场景与滚动穿越见 lib/three-scene.ts；着色器见 lib/three-shaders.ts；
//    月亮 / 卫星 / 低云 / 远处天体见 lib/sky-dome.ts。
// 5) 黄昏渐变是给星点留出的「比星暗」余量：星是发光体，在近白底上只能画成黑点或彩色纸屑。
//    它只占首屏上方约 3/4，往下淡出，所以首屏文字都落在够亮、读得清的区域。
import { useEffect, useRef } from "react";
import { useThreeBgEnabled } from "@/lib/bg3d";
import { createThreeScene } from "@/lib/three-scene";

type ThreeModule = typeof import("three");

// 用 multiply 压暗而不是覆盖：直接盖一层深色会把站长自己上传的 hero 背景图糊掉，
// 而 multiply 是「按比例压暗」，图还在，只是从白昼变成黄昏 —— 这才给加色星点留出亮度余量。
// 72% 处那道暖色是地平线天光，往下淡出，首屏底部接回页面浅色。
const SKY =
  "linear-gradient(180deg," +
  " oklch(0.55 0.1 265 / 0.95) 0%," +
  " oklch(0.63 0.09 267 / 0.88) 18%," +
  " oklch(0.74 0.06 273 / 0.68) 40%," +
  " oklch(0.87 0.032 281 / 0.34) 60%," +
  " oklch(0.95 0.03 68 / 0.18) 72%," +
  " transparent 88%)";

export function ThreeBackground() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const skyRef = useRef<HTMLDivElement | null>(null);
  const hiddenRef = useRef(false);
  const enabled = useThreeBgEnabled();

  // 滚出首屏就停绘：天空只占第一屏，之后继续渲染纯属浪费电
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const io = new IntersectionObserver(([entry]) => {
      hiddenRef.current = !entry.isIntersecting;
    }, { threshold: 0 });
    io.observe(root);
    return () => io.disconnect();
  }, [enabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const THREE: ThreeModule = await import("three");
        if (disposed) return;
        teardown = createThreeScene(THREE, host, () => hiddenRef.current);
      } catch (error) {
        // 清掉可能残留的画布与黄昏底，把页面交回 CSS 炫彩渐变
        host.replaceChildren();
        if (skyRef.current) skyRef.current.style.display = "none";
        console.warn(
          "[three-bg] 3D 背景未启动，继续使用 CSS 炫彩渐变：",
          error instanceof Error ? error.message : error
        );
      }
    })();

    return () => {
      disposed = true;
      teardown?.();
      teardown = null;
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
      <div ref={skyRef} className="absolute inset-0" style={{ background: SKY, mixBlendMode: "multiply" }} />
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
