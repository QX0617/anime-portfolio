// GitHub 同步相关的前端请求封装
//
// README / 目录 / 文件内容一律通过 github-proxy 只读代理实时获取：
// 浏览器直连 api.github.com 会被 CORS 与匿名限额卡住，代理侧做了严格白名单。
import { supabaseUrl } from "@/supabase/client";
import { publicUrlFor } from "./storage";
import type { GithubRepoRow, TreeEntry } from "./types";

const FN = `${supabaseUrl}/functions/v1`;

/** 网关 5xx / 非 JSON 响应（例如 504 的 HTML 错误页）都属于可重试的瞬时故障 */
class RetryableError extends Error {}

async function callOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FN}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  // ⚠️ 平台网关超时/故障时返回的是 HTML 错误页，直接 JSON.parse 会抛出
  // 难懂的 `Unexpected token '<'`；这里统一转成可读文案，并标成可重试。
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") {
    // 修复 504 的关键证据：这里能看出后端返回的是 HTML 错误页而不是 JSON
    console.error(`[github] ${path} 返回非 JSON 内容 status=${res.status} type=${res.headers.get("content-type") ?? "-"} head=${text.slice(0, 80)}`);
    if (res.status >= 500) throw new RetryableError(`云服务网关超时（${res.status}）`);
    throw new Error(`云函数返回了非预期内容（${res.status}），请稍后重试`);
  }
  if (!res.ok) {
    const raw = (data as { error?: unknown }).error;
    const msg = typeof raw === "string" && raw ? raw : `请求失败 (${res.status})`;
    if (res.status >= 500) throw new RetryableError(msg);
    throw new Error(msg);
  }
  return data as T;
}

/** 带一次退避重试：网关偶发 504 时不让用户直接看到失败 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await callOnce<T>(path, init);
  } catch (e) {
    if (!(e instanceof RetryableError)) throw e;
    console.warn(`[github] ${path} 首次失败，1.5s 后重试：${e.message}`);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await callOnce<T>(path, init);
    } catch (e2) {
      if (e2 instanceof RetryableError) throw new Error("云服务网关超时了，请稍等几秒再点一次「立即同步」");
      throw e2 instanceof Error ? e2 : new Error("请求失败");
    }
  }
}

/**
 * 通用云函数 POST 调用（封面生图等）。
 * ⚠️ 必须自己管超时：`AbortSignal.timeout` 抛的是 `AbortError` 而不是 `Error` 实例，
 * 直接冒泡会变成用户看不懂的「Uncaught AbortError」。
 */
export async function callEdge<T>(name: string, payload: unknown, timeoutMs = 90_000): Promise<T> {
  try {
    return await call<T>(name, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`等待超过 ${Math.round(timeoutMs / 1000)} 秒还没结果，请稍后重试`);
    }
    throw e instanceof Error ? e : new Error("云函数调用失败");
  }
}

/** 单次同步的响应：函数按时间预算分批，未做完时 done=false，前端带 nextCursor 续跑 */
type SyncResponse = {
  total?: number;
  processed?: number;
  created?: number;
  updated?: number;
  nextCursor?: number;
  done?: boolean;
  reason?: string;
  listed?: number;
};

export type SyncSummary = { total: number; created: number; updated: number; listed: number; rounds: number };

const MAX_SYNC_ROUNDS = 12;
/** 同一时刻只允许一次同步在跑：「每日自动核对」与「立即同步」共用同一个请求 */
let syncing: Promise<SyncSummary> | null = null;

async function syncRounds(org?: string): Promise<SyncSummary> {
  let cursor = 0;
  let created = 0;
  let updated = 0;
  let listed = 0;
  let total = 0;
  for (let round = 1; round <= MAX_SYNC_ROUNDS; round++) {
    const res = await call<SyncResponse>("github-sync", {
      method: "POST",
      body: JSON.stringify(org ? { org, cursor } : { cursor }),
    });
    total = res.total ?? total;
    created += res.created ?? 0;
    updated += res.updated ?? 0;
    listed += res.listed ?? 0;
    cursor = res.nextCursor ?? 0;
    const done = res.done !== false;
    console.info(`[github] 同步第 ${round} 轮 done=${done} processed=${res.processed ?? 0} next=${cursor} total=${total}${res.reason ? ` reason=${res.reason}` : ""}`);
    if (done) return { total, created, updated, listed, rounds: round };
    // 防御：本轮一个都没处理却还没做完，说明游标没推进，直接收手避免空转
    if (!(res.processed ?? 0)) break;
  }
  console.warn("[github] 同步达到轮次上限，仍有仓库未处理");
  return { total, created, updated, listed, rounds: MAX_SYNC_ROUNDS };
}

/**
 * 触发一次组织同步（拉取仓库清单 + 元信息）。
 * 函数侧按时间预算分批返回，这里自动带游标续跑，直到 done 或达到轮次上限。
 */
export async function runGithubSync(org?: string): Promise<SyncSummary> {
  if (syncing) {
    console.info("[github] 已有同步在进行，复用同一次请求");
    return syncing;
  }
  syncing = syncRounds(org).finally(() => {
    syncing = null;
  });
  return syncing;
}

/** 读取 README 原文 */
export async function fetchReadme(repo: Pick<GithubRepoRow, "owner_login" | "name">, ref: string, name: string): Promise<string> {
  const q = new URLSearchParams({ action: "readme", owner: repo.owner_login, repo: repo.name, ref, name });
  const { text } = await call<{ text: string }>(`github-proxy?${q}`);
  return text;
}

/** 列出一层目录 */
export async function fetchTree(owner: string, repo: string, ref: string, path: string | null): Promise<TreeEntry[]> {
  const q = new URLSearchParams({ action: "tree", owner, repo, ref });
  if (path) q.set("path", path);
  const { entries } = await call<{ entries: TreeEntry[] }>(`github-proxy?${q}`);
  return entries ?? [];
}

/** 读取单个文件内容 */
export async function fetchBlob(owner: string, repo: string, ref: string, path: string): Promise<string> {
  const q = new URLSearchParams({ action: "blob", owner, repo, ref, path });
  const { text } = await call<{ text: string }>(`github-proxy?${q}`);
  return text;
}

/** GitHub 仓库内文件的 raw 直链（仅用于展示/下载指引，浏览器侧不保证可达） */
export function githubRawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** 仓库内某个文件的元信息（体积 / sha），用于判断站内快照是否已经落后 */
export type EntryMeta = { size: number; sha: string; path: string };

/**
 * 只取仓库入口文件的**元信息**，不下载正文。
 * 体验页用它比对「站内快照 vs 仓库最新版」：体积差得明显就说明快照旧了，
 * 直接改用仓库版本渲染，避免用户看到旧版里缺失的功能（408- 的题库就是这么丢的）。
 * 失败返回 null —— 判断不了就沿用站内快照，绝不因此让体验页打不开。
 */
export async function fetchEntryMeta(owner: string, repo: string, ref: string, path: string): Promise<EntryMeta | null> {
  try {
    const q = new URLSearchParams({ action: "meta", owner, repo, ref, path });
    const meta = await call<EntryMeta>(`github-proxy?${q}`);
    return typeof meta?.size === "number" ? meta : null;
  } catch (e) {
    console.warn(`[github] 入口元信息读取失败（沿用站内快照）：${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * 站内快照的字节数（只发 HEAD，不下载正文）。
 * ⚠️ 实测平台 storage 对 HEAD 回的是 `content-length: 0`，所以这里多数情况下拿不到体积，
 * 调用方会落到「信息不足 → 沿用站内快照」。它只是一层保险，**不能当主判据**：
 * 「站内快照 vs 仓库原文」到底哪个能跑，靠体积是判不出来的（408- 的仓库原文体积更小却是坏的）。
 */
export async function mirroredSize(entry: string): Promise<number | null> {
  try {
    const objectPath = entry.includes("/object/public/")
      ? decodeURIComponent(entry.split("/object/public/")[1].split("/").slice(1).join("/"))
      : entry;
    const res = await fetch(publicUrlFor(objectPath), { method: "HEAD", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "");
    if (!(Number.isFinite(len) && len > 0)) {
      // 平台 storage 的 HEAD 不带 content-length（实测恒为 0），记一条好知道比对为什么没生效
      console.warn(`[github] 站内快照体积探测拿不到长度（沿用站内快照）：${objectPath}`);
      return null;
    }
    return len;
  } catch (e) {
    // ⚠️ AbortSignal.timeout 抛的是 AbortError，不是 Error 实例，必须就地转成可读文案
    console.warn(`[github] 站内快照体积探测失败（沿用站内快照）：${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * 从任意地址拉一份 HTML 文本（用于「把仓库最新版存成站内快照」）。
 * ⚠️ 必须自己管超时：`AbortSignal.timeout` 抛的是 `AbortError`，直接冒泡到 UI 会变成
 * 一句用户看不懂的「Uncaught AbortError」。这里统一转成可读文案。
 */
export async function fetchHtmlText(url: string, timeoutMs = 30_000): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`页面读取失败 (${res.status})`);
    return await res.text();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`读取超时（超过 ${Math.round(timeoutMs / 1000)} 秒），可能是网络访问不到 GitHub，稍后再试`);
    }
    throw e instanceof Error ? e : new Error("页面读取失败");
  }
}

/**
 * 站内体验：读取本站存储桶里的 HTML 文本（同步任务镜像的 gh-demo/…，或站长上传的 projects/…）。
 * ⚠️ 三条路都被实测证伪，只剩这一条：
 * 1) Edge Function 直接返回大响应 → 平台网关 ~60s 504；
 * 2) 浏览器直连 GitHub（raw / Contents API）→ raw 域名不可达、大文件被 302 到 media 域后 Failed to fetch；
 * 3) iframe 直接指向 storage public URL → 平台读取时把 content-type 统一改写成 text/plain，浏览器不渲染。
 * 所以这里只从站内拉文本，调用方交给 `iframe` 的 `srcDoc` 渲染（Blob URL 的 origin 是 null，
 * 存储 API 会被浏览器拒绝，依赖 localStorage 的应用会静默降级成空数据）。
 * @param entry entry_url 字段值：桶内路径（gh-demo/…）或完整站内地址（…/object/public/{bucket}/{path}）
 */
export async function fetchMirroredHtml(entry: string): Promise<string> {
  const objectPath = entry.includes("/object/public/")
    ? decodeURIComponent(entry.split("/object/public/")[1].split("/").slice(1).join("/"))
    : entry;
  const res = await fetch(publicUrlFor(objectPath));
  if (!res.ok) throw new Error(`体验页读取失败 (${res.status})`);
  return await res.text();
}

/** 相对时间：昨天/3 天前这类人话，超过 30 天退化为日期 */
export function sinceLabel(iso: string | null): string {
  if (!iso) return "从未同步";
  const diff = Date.now() - new Date(iso).getTime();
  const day = Math.floor(diff / 86400000);
  if (day <= 0) {
    const hour = Math.floor(diff / 3600000);
    return hour <= 0 ? "刚刚" : `${hour} 小时前`;
  }
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function starLabel(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
