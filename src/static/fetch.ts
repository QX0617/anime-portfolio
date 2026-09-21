import data from './data.json';

export const IS_STATIC_SNAPSHOT = true;

type Row = Record<string, unknown>;
const TABLES = data as unknown as Record<string, Row[]>;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });

const BARE_PATH = /\/([a-z_]+)$/;

export async function staticFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const req = new Request(input as RequestInfo, init);
  const u = new URL(req.url, 'http://static.local');

  const fn = u.pathname.match(/\/functions\/v1\/([\w-]+)/);
  if (fn) {
    if (fn[1] === 'verify-key') return json({ ok: false });
    return json({ ok: false, error: '这是静态快照，不提供云端功能（同步 / README / 生成封面）' }, 400);
  }

  const tbl = u.pathname.match(BARE_PATH);
  const table = tbl ? TABLES[tbl[1]] : undefined;
  if (!table) return json({ message: `静态快照没有这张表：${u.pathname}` }, 404);

  if (req.method !== 'GET' && req.method !== 'HEAD')
    return json({ code: '42802', message: '这是静态快照，不支持修改内容' }, 405);

  let rows = table;
  for (const [col, cond] of u.searchParams.entries()) {
    if (['order', 'limit', 'offset', 'select'].includes(col)) continue;
    if (cond.startsWith('eq.')) {
      const want = cond.slice(3);
      rows = rows.filter((r) => String(r[col] ?? '') === want);
    }
  }

  const order = u.searchParams.get('order');
  if (order) {
    const [col, dir = 'asc'] = order.split('.');
    const sign = dir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[col];
      const y = b[col];
      if (x == null) return 1;
      if (y == null) return -1;
      return (x as never) > (y as never) ? sign : -sign;
    });
  }

  const limit = Number(u.searchParams.get('limit') ?? '0');
  if (limit > 0) rows = rows.slice(0, limit);

  if ((req.headers.get('accept') ?? '').includes('pgrst.object')) {
    if (!rows.length) return json({ code: 'PGRST116', message: 'Not Found' }, 406);
    return json(rows[0]);
  }
  const last = Math.max(0, rows.length - 1);
  return json(rows, 200, { 'Content-Range': `0-${last}/${rows.length}` });
}
