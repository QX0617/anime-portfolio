/**
 * 重新生成静态快照：从 Meoo 项目 urba7opytf72 拉数据与资源，写进本仓库。
 *
 *   node scripts/bake-snapshot.mjs        （需要 meoo CLI 已登录：meoo whoami）
 *   之后 git commit + push，Actions 会自动重新发布到 GitHub Pages。
 *
 * 图片统一转 WebP（依赖 ffmpeg）；PNG 目标名自动改后缀，data.json 里的引用同步改写。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const PROJECT = 'urba7opytf72';
const BUCKET = '5193facd-7104-4e07-a523-378ee2f604bc';
const HOST = 'n1fokypnap7g082k.database.meoo.xyz';
const BUCKET_BASE = `https://${HOST}/storage/v1/object/public/${BUCKET}`;

/**
 * 定位全局安装的 Meoo CLI 的 JS 入口。
 * Windows 上 `meoo` 是 .cmd 垫片，execFileSync 不经 shell 时找不到，所以用 node 直接跑 JS 入口。
 */
const meooScript = () => {
  const rel = path.join('@aliyun-meoo', 'cli', 'bin', 'meoo.js');
  const roots = [
    process.env.MEOO_CLI_JS && path.dirname(path.dirname(path.dirname(process.env.MEOO_CLI_JS))),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'),
    process.env.HOME && path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, rel);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到 Meoo CLI，请设置环境变量 MEOO_CLI_JS 指向 bin/meoo.js');
};

const MEOO = meooScript();

const meooJson = (sql) =>
  JSON.parse(
    execFileSync(process.execPath, [MEOO, '--json', 'db', 'query', '--project', PROJECT, sql], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  ).data.rows;

const rows = meooJson(
  `SELECT (SELECT jsonb_agg(row_to_json(x)) FROM public.site_settings x) AS settings,` +
    ` (SELECT jsonb_agg(row_to_json(x) ORDER BY sort_order) FROM public.projects x) AS projects,` +
    ` (SELECT jsonb_agg(row_to_json(x) ORDER BY name) FROM public.github_repos x) AS repos,` +
    ` (SELECT coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) FROM public.github_sync_state x) AS sync_state`
)[0];

const objects = meooJson(
  `SELECT name FROM storage.objects WHERE bucket_id='${BUCKET}' ORDER BY name`
).map((r) => r.name);

const localPath = (p) => `assets/${p.replace(/\.png$/, '.webp')}`;
const parse = (s) => (typeof s === 'string' ? JSON.parse(s) : s);

/** localize 命中过的桶内路径；后面按它决定哪些资源要保留 */
const wanted = new Set();

const localize = (v, key) => {
  if (typeof v === 'string') {
    const m = v.match(/\/object\/public\/[0-9a-f-]+\/(.+)$/);
    if (m) {
      const p = decodeURIComponent(m[1]);
      wanted.add(p);
      return key === 'entry_url' || key === 'source_url' ? p : localPath(p);
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => localize(x, key));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x, k)]));
  return v;
};

const data = {
  site_settings: parse(rows.settings).map(localize),
  projects: parse(rows.projects).map(localize),
  github_repos: parse(rows.repos).map(localize),
  github_sync_state: parse(rows.sync_state).map(localize),
};

fs.mkdirSync(path.join(ROOT, 'src', 'static'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'static', 'data.json'), JSON.stringify(data, null, 1));

// 判定「被引用」用子串匹配，宁可多留不可误删：完整路径 / 本地化路径 / 纯文件名 任一命中即保留。
// 代码里硬编码的默认背景与头像不进 data.json，按前缀保留。
const blob = JSON.stringify(data);
for (const p of objects)
  if (
    p.startsWith('defaults/') ||
    blob.includes(p) ||
    blob.includes(localPath(p)) ||
    blob.includes(p.split('/').pop())
  )
    wanted.add(p);

console.log(`data.json 写出；保留资源 ${wanted.size} / ${objects.length} 个`);

let bytes = 0;
for (const p of objects) {
  const dest = p.endsWith('.png') ? p.replace(/\.png$/, '.webp') : p;
  const abs = path.join(ASSETS, dest);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!wanted.has(p) && fs.existsSync(abs)) {
    fs.rmSync(abs);
    console.log(`  删除未引用 ${dest}`);
    continue;
  }
  if (!wanted.has(p)) continue;
  if (fs.existsSync(abs)) {
    bytes += fs.statSync(abs).size;
    console.log(`  跳过 ${dest}`);
    continue;
  }
  const res = await fetch(`${BUCKET_BASE}/${p.split('/').map(encodeURIComponent).join('/')}`, {
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`下载失败 ${p}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (p.endsWith('.png')) {
    const tmp = abs + '.src.png';
    fs.writeFileSync(tmp, buf);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-c:v', 'libwebp', '-quality', '82', abs]);
    fs.unlinkSync(tmp);
  } else {
    fs.writeFileSync(abs, buf);
  }
  bytes += fs.statSync(abs).size;
  console.log(`  下载 ${dest} ${(buf.length / 1024).toFixed(0)} KB -> ${(fs.statSync(abs).size / 1024).toFixed(0)} KB`);
}

const leaked = JSON.stringify(data).match(/https?:\/\/[^"]*(?:meoo\.xyz|meoo\.host|meoo\.fun|meoo\.run)[^"]*/g) || [];
console.log(`\n资源合计 ${(bytes / 1048576).toFixed(1)} MB | data.json 内远端引用 ${leaked.length}`);
if (leaked.length) console.warn('警告：仍有远端引用\n' + leaked.join('\n'));
