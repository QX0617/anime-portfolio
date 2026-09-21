// 页面级 3D 星海背景（three.js / WebGL）
//
// 设计约束（勿改）：
// 1) 叠加层，不是替换层：fixed inset-0 z-[1]，压在区块背景（z-auto）之上、
//    正文（z-10）与所有弹层（z-50 起）之下，所以各区块原有图片 / CSS 炫彩渐变完全不受影响。
// 2) 任何环节失败（three 加载失败、WebGL 不可用、上下文丢失）都只移除自己，
//    页面立刻回到 CSS 炫彩渐变，绝不出现白屏或黑块。
// 3) 场景与滚动穿越的实现见 lib/three-scene.ts；着色器见 lib/three-shaders.ts。
import { useEffect, useRef } from "react";
import { useThreeBgEnabled } from "@/lib/bg3d";
import { createThreeScene } from "@/lib/three-scene";

type ThreeModule = typeof import("three");

export function ThreeBackground() {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
        // 清掉可能残留的画布，把页面交回 CSS 炫彩渐变
        host.replaceChildren();
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
  return <div ref={hostRef} aria-hidden className="pointer-events-none fixed inset-0 z-[1]" />;
}
