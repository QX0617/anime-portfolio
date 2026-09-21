// 轻量 Markdown 渲染：无第三方依赖，输出受控 React 元素（不使用 dangerouslySetInnerHTML）
import { Fragment, type ReactNode } from "react";

type Token =
  | { type: "heading"; level: number; content: string }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; content: string };

const FENCE = /^```([\w+-]*)\s*$/;

export function tokenize(md: string): Token[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Token[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s{0,3}(```|~~~)/.test(line)) {
      const lang = (line.match(FENCE)?.[1] ?? "").toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s{0,3}(```|~~~)\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // 跳过闭合围栏
      out.push({ type: "code", lang, lines: body });
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push({ type: "heading", level: heading[1].length, content: heading[2].trim() }); i++; continue; }

    if (/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push({ type: "hr" }); i++; continue; }

    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push({ type: "quote", lines: body });
      continue;
    }

    // 表格：表头行 + 分隔行
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const splitRow = (row: string) =>
        row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push({ type: "table", header, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      let current = "";
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !(bullet.test(lines[i]) || numbered.test(lines[i]))) {
        current += " " + lines[i++].trim(); // 续行合并进上一条
      }
      while (i < lines.length && (bullet.test(lines[i]) || numbered.test(lines[i]))) {
        if (current) { items.push(current.trim()); current = ""; }
        let text = lines[i].replace(bullet, "").replace(numbered, "");
        i++;
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
          text += " " + lines[i++].trim();
        }
        current = text;
      }
      if (current) items.push(current.trim());
      out.push({ type: "list", ordered, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|~~~|\s{0,3}>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length) out.push({ type: "paragraph", content: para.join(" ") });
    else i++;
  }

  return out;
}

/** 行内语法：代码、粗体、斜体、删除线、链接、图片 */
export function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(~~[^~]+~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) {
      nodes.push(<img key={key} src={safeHref(m[3])} alt={m[2]} loading="lazy" className="my-3 max-w-full rounded-xl" />);
    } else if (m[4]) {
      nodes.push(
        <a key={key} href={safeHref(m[6])} target="_blank" rel="noreferrer noopener" className="font-medium text-lilac underline decoration-lilac/40 underline-offset-2 hover:decoration-lilac">
          {renderInline(m[5], key)}
        </a>,
      );
    } else if (m[7]) {
      nodes.push(<code key={key} className="rounded-md bg-lilac/12 px-1.5 py-0.5 font-mono text-[0.86em] text-ink">{m[7].slice(1, -1)}</code>);
    } else if (m[8] || m[9]) {
      nodes.push(<strong key={key} className="font-semibold text-ink">{(m[8] ?? m[9]!).slice(2, -2)}</strong>);
    } else if (m[10]) {
      nodes.push(<em key={key}>{m[10].slice(1, -1)}</em>);
    } else if (m[11]) {
      nodes.push(<del key={key} className="text-muted-foreground">{m[11].slice(2, -2)}</del>);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 只放行 http(s)、相对路径与锚点，挡掉 javascript: 等危险协议 */
function safeHref(raw: string): string {
  const href = raw.trim();
  if (/^(https?:|mailto:|\/|#|\.)/i.test(href)) return href;
  if (/^[\w./-]+$/.test(href)) return href;
  return "#";
}

const HEADING_SIZE = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];

export function MarkdownView({ source, className = "" }: { source: string; className?: string }) {
  const tokens = tokenize(source);
  return (
    <div className={`space-y-4 text-[14.5px] leading-[1.85] text-ink-soft ${className}`}>
      {tokens.map((t, i) => {
        const key = `t${i}`;
        switch (t.type) {
          case "heading": {
            const Tag = (`h${Math.min(t.level + 1, 6)}`) as "h2";
            return (
              <Tag key={key} className={`pt-1 font-display font-bold tracking-tight text-ink ${HEADING_SIZE[t.level - 1]} ${t.level <= 2 ? "border-b border-border/60 pb-2" : ""}`}>
                {renderInline(t.content, key)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-2xl bg-ink/[0.055] p-4 font-mono text-[12.5px] leading-relaxed text-ink ring-1 ring-border/50">
                <code>{t.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="rounded-r-xl border-l-[3px] border-lilac/60 bg-lilac/[0.07] px-4 py-2.5 italic text-ink-soft">
                {t.lines.map((l, j) => <p key={j}>{renderInline(l, `${key}-${j}`)}</p>)}
              </blockquote>
            );
          case "list":
            return t.ordered ? (
              <ol key={key} className="ml-1 list-inside list-decimal space-y-1.5 marker:font-mono marker:text-[12px] marker:text-lilac">
                {t.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}
              </ol>
            ) : (
              <ul key={key} className="ml-1 space-y-1.5">
                {t.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-lilac/70" />
                    <span>{renderInline(it, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-2xl ring-1 ring-border/60">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead className="bg-lilac/[0.08]">
                    <tr>{t.header.map((h, j) => <th key={j} className="px-3.5 py-2.5 font-semibold text-ink">{renderInline(h, `${key}-h${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {t.rows.map((row, r) => (
                      <tr key={r} className="border-t border-border/50 odd:bg-white/40">
                        {row.map((c, j) => <td key={j} className="px-3.5 py-2.5 align-top">{renderInline(c, `${key}-${r}-${j}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="!my-6 border-0 h-px bg-gradient-to-r from-transparent via-lilac/40 to-transparent" />;
          default:
            return <p key={key}>{renderInline(t.content, key)}</p>;
        }
      })}
      {tokens.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Fragment>这份文档还是空的。</Fragment>
        </p>
      )}
    </div>
  );
}
