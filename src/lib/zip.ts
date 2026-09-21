import JSZip from "jszip";
import type { ProjectFile } from "./types";

export type UnpackedFile = {
  /** 归一化后的相对路径，如 assets/index-3f2a.js */
  path: string;
  blob: Blob;
  size: number;
};

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git\/)/i;

function normalizePath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/{2,}/g, "/")
    .split("/")
    .filter((seg) => seg !== "" && seg !== ".")
    .map((seg) => seg.replace(/\s+/g, "-"))
    .join("/");
}

export async function unpackZip(file: File): Promise<UnpackedFile[]> {
  const zip = await JSZip.loadAsync(file);
  const out: UnpackedFile[] = [];
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const entry of entries) {
    const path = normalizePath(entry.name);
    if (!path || IGNORED.test(path)) continue;
    const blob = await entry.async("blob");
    out.push({ path, blob, size: blob.size });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 找出入口 index.html：优先层级最浅、路径最短的那个 */
export function findEntryHtml(files: UnpackedFile[]): UnpackedFile | null {
  const candidates = files.filter((f) => /(^|\/)index\.html?$/i.test(f.path));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const da = a.path.split("/").length;
    const db = b.path.split("/").length;
    return da - db || a.path.length - b.path.length;
  })[0];
}

/** 入口文件所在目录前缀，用于解析相对路径 */
function entryDir(entryPath: string): string {
  const idx = entryPath.lastIndexOf("/");
  return idx === -1 ? "" : entryPath.slice(0, idx);
}

function resolveRelative(baseDir: string, ref: string): string {
  const joined = ref.startsWith("/") ? ref.replace(/^\/+/, "") : baseDir ? `${baseDir}/${ref}` : ref;
  const stack: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

/**
 * 把 index.html 里的相对资源引用改写为已上传文件的绝对 public URL，
 * 让构建产物在 iframe 里能正确加载 js/css/图片。
 */
export async function rewriteEntryHtml(
  entry: UnpackedFile,
  urlMap: Map<string, string>,
): Promise<string> {
  const html = await entry.blob.text();
  const baseDir = entryDir(entry.path);
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 注入 <base>，让运行时动态 import / 相对跳转有参照
  const refs: Array<{ el: Element; attr: string }> = [];
  const selectorPairs: Array<[string, string]> = [
    ["script[src]", "src"],
    ["link[href]", "href"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["audio[src]", "src"],
    ["use[href]", "href"],
    ["image[href]", "href"],
  ];
  for (const [selector, attr] of selectorPairs) {
    doc.querySelectorAll(selector).forEach((el) => refs.push({ el, attr }));
  }

  for (const { el, attr } of refs) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const trimmed = value.trim();
    if (/^(https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(trimmed)) continue;
    const target = resolveRelative(baseDir, trimmed.split("#")[0].split("?")[0]);
    const mapped = urlMap.get(target) ?? urlMap.get(target.replace(/^-/, ""));
    if (mapped) el.setAttribute(attr, mapped);
  }

  // 内联 style 里的 url(...)
  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent ?? "";
    styleEl.textContent = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, q: string, ref: string) => {
      if (/^(https?:|data:|#)/i.test(ref)) return match;
      const target = resolveRelative(baseDir, ref);
      const mapped = urlMap.get(target);
      return mapped ? `url("${mapped}")` : match;
    });
  });

  // 相对路径的 modulepreload / import 无法穷举，补一个 base 指向入口目录的 storage 前缀
  const head = doc.head ?? doc.createElement("head");
  if (!doc.querySelector("base")) {
    const dirUrl = entry.path.includes("/")
      ? entryDirUrl(entry.path, urlMap)
      : urlMap.get(entry.path) ?? "";
    if (dirUrl) {
      const baseEl = doc.createElement("base");
      baseEl.setAttribute("href", dirUrl);
      head.insertBefore(baseEl, head.firstChild);
    }
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function entryDirUrl(entryPath: string, urlMap: Map<string, string>): string {
  const entryUrl = urlMap.get(entryPath);
  if (!entryUrl) return "";
  const dir = entryPath.includes("/") ? entryDir(entryPath) : "";
  const prefix = entryUrl.slice(0, entryUrl.length - entryPath.length);
  return dir ? `${prefix}${dir}/` : prefix;
}

export type BuiltBundle = {
  entry: UnpackedFile;
  assets: UnpackedFile[];
};

/** 从文件集合（多选上传或 zip）里整理出入口页与其余资源 */
export function assembleBundle(files: UnpackedFile[]): BuiltBundle | null {
  const cleaned = files.filter((f) => f.size > 0 || /\.(html?|css|js)$/i.test(f.path));
  const entry = findEntryHtml(cleaned);
  if (!entry) return null;
  return { entry, assets: cleaned.filter((f) => f !== entry) };
}

export type { ProjectFile };
