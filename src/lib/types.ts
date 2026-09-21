// 全站共享类型契约
import { publicUrlFor } from "./storage";

export type SectionKey = "site" | "hero" | "projects" | "about" | "contact";

export type BackgroundConfig = {
  /** gradient = 内置炫彩渐变；image = 上传图片；inherit = 跟随整站背景 */
  mode: "gradient" | "image" | "inherit";
  url?: string;
  /** 遮罩浓度 0-85（%） */
  overlay: number;
  /** 背景模糊 0-20（px） */
  blur: number;
};

export type SocialLink = {
  label: string;
  url: string;
};

export type SiteSettings = {
  username: string;
  avatar_url: string | null;
  tagline: string;
  bio: string;
  social_links: SocialLink[];
  backgrounds: Partial<Record<SectionKey, BackgroundConfig>>;
};

export type ProjectFile = {
  /** 原始相对路径，如 assets/index-3f2a.js */
  path: string;
  url: string;
  size: number;
};

export type DemoMode = "none" | "inline" | "external";

/** 源码 zip 解压后的归档条目（内容按需从 zip 里取，不入库） */
export type SourceFileEntry = {
  path: string;
  size: number;
};

export type Project = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  cover_url: string | null;
  demo_mode: DemoMode;
  /** 站内体验入口（storage public url，已重写资源路径） */
  entry_url: string | null;
  /** 源码包 zip 的 storage public url */
  source_url: string | null;
  source_name: string | null;
  /** 构建产物文件清单 */
  files: ProjectFile[];
  /** 源码包文件树（用于站内在线浏览） */
  source_files: SourceFileEntry[];
  /** 外部链接体验（填 url 即可） */
  external_url: string | null;
  sort_order: number;
  hidden: boolean;
  created_at: string;
  updated_at: string;
  /** 'manual' = 站长手动创建；'github' = 由组织同步派生 */
  origin?: "manual" | "github";
  gh_full_name?: string | null;
  gh_stars?: number;
  gh_language?: string | null;
  gh_pushed_at?: string | null;
  gh_html_url?: string | null;
  /** GitHub 仓库默认分支（详情页实时读源码用） */
  default_branch?: string;
  /** 同步函数探测到的 README 路径 */
  readme_path_hint?: string | null;
  /** GitHub 仓库内可 iframe 直跑的 HTML 入口路径（站内体验） */
  gh_entry_path?: string | null;
  /** 站长手动改过的字段名：同步任务见到这些字段就跳过，不再用仓库数据覆盖 */
  overridden_fields?: string[];
};

/** GitHub 同步：github-proxy 返回的一层目录条目 */
export type TreeEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  sha: string;
};

/** github_repos 表行（站长在设置抽屉里挑选哪些仓库上站） */
export type GithubRepoRow = {
  id: string;
  repo_id: number;
  name: string;
  full_name: string;
  owner_login: string;
  default_branch: string;
  html_url: string;
  homepage: string | null;
  gh_description: string | null;
  language: string | null;
  topics: string[];
  license_spdx: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  has_pages: boolean;
  size_kb: number;
  pushed_at: string | null;
  readme_path: string | null;
  /** 仓库内可 iframe 直跑的 HTML 入口路径 */
  demo_entry_path: string | null;
  intro_zh: string;
  intro_source: string;
  show_on_site: boolean;
  project_id: string | null;
  synced_at: string | null;
};

export type GithubSyncState = {
  org_login: string;
  last_sync_at: string | null;
  last_status: string;
  last_message: string;
  repo_count: number;
};

export const DEFAULT_BACKGROUNDS: Record<SectionKey, BackgroundConfig> = {
  site: { mode: "gradient", overlay: 0, blur: 0 },
  hero: {
    mode: "image",
    url: publicUrlFor("defaults/hero-bg.png"),
    overlay: 30,
    blur: 0,
  },
  projects: {
    mode: "image",
    url: publicUrlFor("defaults/projects-bg.png"),
    overlay: 55,
    blur: 0,
  },
  about: {
    mode: "image",
    url: publicUrlFor("defaults/about-bg.png"),
    overlay: 45,
    blur: 0,
  },
  contact: {
    mode: "image",
    url: publicUrlFor("defaults/contact-bg.png"),
    overlay: 40,
    blur: 0,
  },
};

export const DEFAULT_AVATAR = publicUrlFor("defaults/avatar.png");

export const KEY_SALT = "meoo-portfolio-v1";
