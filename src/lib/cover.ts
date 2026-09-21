// 作品封面：按项目内容拼一句提示词，交给云函数生图并落桶，拿回永久地址。
//
// 统一风格：全站封面共用同一套美术方向（炫彩动漫柔和风），只把「主体」换掉，
// 所以卡片排在一起时配色和构图是一致的。
import { callEdge } from "./github";
import { publicUrlFor } from "./storage";

/** 统一的封面美术方向 —— 全站共用，改这里所有新生成的封面一起变 */
export const COVER_STYLE =
  "soft pastel anime illustration, gentle aurora gradient background in lilac pink mint and butter yellow, " +
  "clean flat soft shading with subtle glow, dreamy diffused light, generous negative space, " +
  "wide banner composition, cohesive pastel palette, no text no letters no words no watermark no logo";

/** 生成封面需要的项目信息（手动项目 / GitHub 项目都够用） */
export type CoverSource = {
  id: string;
  title: string;
  description?: string | null;
  tags?: string[] | null;
  gh_language?: string | null;
};

/**
 * 把项目内容压成一句「画什么」。
 * ⚠️ qwen-image-2.0 的提示词上限 800 字符，主体描述必须截断，否则整次生成会被拒。
 */
export function buildCoverPrompt(project: CoverSource): string {
  const bits: string[] = [];
  if (project.title) bits.push(`project "${project.title}"`);
  if (project.description) bits.push(project.description);
  if (project.tags?.length) bits.push(`keywords: ${project.tags.join(", ")}`);
  if (project.gh_language) bits.push(`built with ${project.gh_language}`);
  const subject = bits.join(" | ").slice(0, 300);

  const prompt =
    `Cover art for a software project — ${subject}. ` +
    "Turn its core idea into one friendly scene: floating UI panels, cute props and abstract shapes that hint at what it does, " +
    "arranged in a calm balanced composition. Art direction: " +
    COVER_STYLE;
  return prompt.slice(0, 800);
}

/**
 * 生成并保存一张封面，返回可直接写进 `projects.cover_url` 的永久地址。
 * ⚠️ 生图是同步长请求（10~30s），调用方必须自己给 loading 态，不要并发调用。
 */
export async function generateCover(project: CoverSource): Promise<{ url: string; path: string }> {
  const prompt = buildCoverPrompt(project);
  const res = await callEdge<{ path?: string }>("portfolio-cover", { prompt, projectId: project.id }, 90_000);
  const path = typeof res?.path === "string" ? res.path : "";
  if (!path) throw new Error("生图服务没有返回封面地址");
  // ⚠️ 重新生成时桶内路径不变，必须带个版本号，否则浏览器会一直用缓存里的旧封面
  return { url: `${publicUrlFor(path)}?v=${Date.now().toString(36)}`, path };
}
