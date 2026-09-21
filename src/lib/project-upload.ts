import { uploadBytes, safeSlug, publicUrlFor } from "./storage";
import { assembleBundle, rewriteEntryHtml, unpackZip, type UnpackedFile } from "./zip";
import type { ProjectFile, SourceFileEntry } from "./types";

export type BuildUploadResult = {
  entryUrl: string;
  files: ProjectFile[];
  /** zip 内未找到 index.html 时为 false，调用方需提示 */
  hasEntry: boolean;
};

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    js: "text/javascript",
    mjs: "text/javascript",
    css: "text/css",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    txt: "text/plain",
    wasm: "application/wasm",
  };
  return map[ext] ?? "application/octet-stream";
}

async function uploadAll(files: UnpackedFile[], prefix: string): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  const list: ProjectFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = `${prefix}/${safeSlug(f.path)}`;
    const { url } = await uploadBytes(path, await blobToBytes(f.blob), contentTypeFor(f.path));
    urlMap.set(f.path, url);
    list.push({ path: f.path, url, size: f.size });
  }
  return urlMap;
}

export async function collectFilesFromZip(file: File): Promise<UnpackedFile[]> {
  return unpackZip(file);
}

/**
 * 上传构建产物（zip 或多文件集合）：
 * 全部文件传上存储 → 重写 index.html 的相对资源路径 → 入口单独以 text/html 上传
 */
export async function uploadBuildBundle(
  files: UnpackedFile[],
  projectId: string,
): Promise<BuildUploadResult & { files: ProjectFile[] }> {
  const bundle = assembleBundle(files);
  if (!bundle) {
    // 没有入口页：作为普通文件保存，不可体验
    return { entryUrl: "", files: [], hasEntry: false };
  }
  const prefix = `projects/${projectId}/build`;
  const assets = await uploadAll(bundle.assets, prefix);
  const urlMap = new Map(assets);
  urlMap.set(bundle.entry.path, publicUrlFor(`${prefix}/__entry__`));
  const html = await rewriteEntryHtml(bundle.entry, urlMap);
  const entryPath = `projects/${projectId}/build/index.html`;
  const { url: entryUrl } = await uploadBytes(
    entryPath,
    new TextEncoder().encode(html),
    "text/html; charset=utf-8",
  );
  const fileList: ProjectFile[] = files.map((f) => ({
    path: f.path,
    url: urlMap.get(f.path) ?? entryUrl,
    size: f.size,
  }));
  return { entryUrl, files: fileList, hasEntry: true };
}

/** 上传单个 html 文件，直接可体验 */
export async function uploadSingleHtml(
  file: File,
  projectId: string,
): Promise<BuildUploadResult> {
  const bytes = await blobToBytes(file);
  const path = `projects/${projectId}/build/index.html`;
  const { url } = await uploadBytes(path, bytes, "text/html; charset=utf-8");
  return {
    entryUrl: url,
    files: [{ path: file.name, url, size: file.size }],
    hasEntry: true,
  };
}

/** 上传源码 zip 包，同时归档文件树供站内在线浏览 */
export async function uploadSourceZip(
  file: File,
  projectId: string,
): Promise<{ url: string; name: string; entries: SourceFileEntry[] }> {
  const name = file.name.endsWith(".zip") ? file.name : `${file.name}.zip`;
  const path = `projects/${projectId}/source/${safeSlug(name)}`;
  const bytes = await blobToBytes(file);
  const { url } = await uploadBytes(path, bytes, "application/zip");
  let entries: SourceFileEntry[] = [];
  try {
    // 解压一次只为拿到路径与体积；失败不影响下载功能
    const unpacked = await unpackZip(file);
    entries = unpacked.map((f) => ({ path: f.path, size: f.size }));
  } catch {
    entries = [];
  }
  return { url, name, entries };
}
