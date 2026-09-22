// 页面级 3D 星海背景（three.js / WebGL）
//
// 设计约束（勿改）：
// 1) **整屏铺底，跟着滚动留在视口**：两层都是 fixed inset-0 z-[1]，压在区块背景
//    （SectionBackground，z-auto）之上、正文（z-10）与所有弹层（z-50 起）之下。
//    做成「只属于首屏」的话，全站就只剩第一屏有星空。
// 2) 黄昏底必须自己就是那个 fixed 元素，不能再套一层带 z-index 的容器：父级一旦建立
//    stacking context，mix-blend-mode 的 backdrop 就被限制在父级内部，而父级是透明的 ——
//    multiply 会静默失效，看上去像页面盖了块不透明的蓝布。
// 3) 压暗会带来对比度问题：直接压在天空上的文字（标题、导语、页脚、未滚动的导航）
//    用的是夜色墨色 --night-*，见 styles.css；卡片类自带浅色底，仍用深色 --ink。
//    这条是「tagline 1.69:1」那次踩坑换来的分工。
// 4) 任何环节失败（three 加载失败、WebGL 不可用、上下文丢失）都两层一起撤掉，
//    页面回到 CSS 炫彩渐变，绝不出现白屏、黑块或残留的半屏蓝。
// 5) 星是发光体，只能画在比它暗的底上：近白底上加色混合等于隐形。
//    场景与滚动穿越见 lib/three-scene.ts；着色器见 lib/three-shaders.ts；
//    月亮 / 卫星 / 低云 / 远处天体见 lib/sky-dome.ts。
import { useEffect, useRef } from "react";
import { useThreeBgEnabled } from "@/lib/bg3d";
import { createThreeScene } from "@/lib/three-scene";

type ThreeModule = typeof import("three");

// multiply 是「按比例压暗」而不是覆盖：图还在，只是从白昼变成夜里。
// 亮度余量算过才敢这么定：全屏幕最亮的一档压到相对亮度 ≤0.12，
// 浅色正文（--night-ink-soft）才有 4.5:1，加色星点也才真的「亮过底」。
// 余晖那一档只保色相不保亮度 —— 之前它抬到 0.163，小字掉到 3.6:1。
// alpha 拉不满（0.88~0.93）是为了让上传的图仍认得出来。
const SKY =
  "linear-gradient(180deg," +
  " oklch(0.24 0.10 268 / 0.93) 0%," +
  " oklch(0.29 0.115 280 / 0.92) 22%," +
  " oklch(0.345 0.125 294 / 0.90) 48%," +
  " oklch(0.385 0.11 315 / 0.90) 70%," +
  " oklch(0.40 0.095 25 / 0.92) 86%," +
  " oklch(0.34 0.10 272 / 0.93) 100%)";

export function ThreeBackground() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const skyRef = useRef<HTMLDivElement | null>(null);
  const enabled = useThreeBgEnabled();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const THREE: ThreeModule = await import("three");
        if (disposed) return;
        teardown = createThreeScene(THREE, host);
      } catch (error) {
        // 画布与夜色底一起撤掉，把页面交回 CSS 炫彩渐变
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
    <>
      <div
        ref={skyRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] mix-blend-multiply"
        style={{ background: SKY }}
      />
      <div ref={hostRef} aria-hidden className="pointer-events-none fixed inset-0 z-[1]" />
    </>
  );
}
