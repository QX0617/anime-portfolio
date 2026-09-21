import { decode } from "base64-arraybuffer";
import { supabase } from "@/supabase/client";

/** portfolio 存储桶 ID（由平台创建后查询得到，勿改） */
export const BUCKET_ID = "5193facd-7104-4e07-a523-378ee2f604bc";

export const MAX_SINGLE_FILE = 15 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 60 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function uploadBytes(
  path: string,
  data: Uint8Array,
  contentType: string,
): Promise<{ path: string; url: string }> {
  const { error } = await supabase.storage
    .from(BUCKET_ID)
    .upload(path, decode(bytesToBase64(data)), { contentType, upsert: true });
  if (error) throw new Error(`上传失败: ${error.message}`);
  return { path, url: publicUrlFor(path) };
}

export async function uploadFile(path: string, file: File): Promise<{ path: string; url: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadBytes(path, bytes, file.type || "application/octet-stream");
}

export function publicUrlFor(path: string): string {
  return `assets/${path.replace(/\.png$/, ".webp")}`;
}

export async function removeByPath(path: string): Promise<void> {
  await supabase.storage.from(BUCKET_ID).remove([path]);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 生成避免中文与特殊字符导致路径问题的安全 slug */
export function safeSlug(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `f${Date.now().toString(36)}`;
}
