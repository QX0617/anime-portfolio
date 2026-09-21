import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { existsSync } from "fs";
import { resolve } from "path";

const SOURCE_LOCATION_PLUGIN_CANDIDATES = [
  process.env.MEOO_SOURCE_LOCATION_PLUGIN_PATH,
  "/app/sdk/lib/src/plugins/source-location-babel.js",
  resolve(process.cwd(), "node_modules/@ali/oneday-agent-sdk/lib/src/plugins/source-location-babel.js"),
].filter(Boolean) as string[];

const SOURCE_LOCATION_PLUGIN_PATH = SOURCE_LOCATION_PLUGIN_CANDIDATES.find((path) => existsSync(path));

/**
 * React + Vite 构建配置
 *
 * 硬约束：
 * - dev server 必须监听 3015 + strictPort（沙箱只开放一个代理端口）
 * - outDir 'dist' / assetsDir 'assets' — 归一化产物目录
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // GitHub Pages 项目页在 /仓库名/ 子路径下，资源必须用相对路径
    base: "./",
    plugins: [
      tailwindcss(),
      TanStackRouterVite(),
      viteReact({
        babel: {
          plugins: SOURCE_LOCATION_PLUGIN_PATH
            ? [[SOURCE_LOCATION_PLUGIN_PATH, { projectRoot: process.cwd() }]]
            : [],
        },
      }),
      tsConfigPaths(),
    ],
    server: {
      host: "0.0.0.0",
      port: 3015,
      strictPort: true,
      allowedHosts: true,
      // HMR 默认关闭：沙箱预览 iframe 下 HMR 的整页 reload 会放大任何 transform error
      // 如需热更，改为: hmr: { clientPort: 443, protocol: 'wss' }
      hmr: false,
      // 平台生成的 src/supabase/client.ts 用 `{origin}/sb-api` 寻址；线上由站点网关代理，
      // 本地必须自己把 /sb-api 转发到 MEOO_PROXY_TARGET，否则数据请求全部 404。
      // /functions/v1 走的是平台按项目域名做的 Origin 白名单，localhost 必被拒 403，
      // 而线上同域请求不带跨源 Origin，所以这里去掉 Origin 来复现线上行为。
      ...(env.MEOO_PROXY_TARGET
        ? {
            proxy: {
              "/sb-api": {
                target: env.MEOO_PROXY_TARGET,
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/sb-api/, ""),
                configure: (proxy) => {
                  proxy.on("proxyReq", (proxyReq) => {
                    proxyReq.removeHeader("origin");
                  });
                },
              },
            },
          }
        : {}),
    },
    build: {
      outDir: "dist",
      assetsDir: "assets",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
