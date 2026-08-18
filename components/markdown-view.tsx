"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// Minimal, safe Markdown renderer for the strict subset emitted by the SiroQ
// analysis engine (#/##/###, paragraphs, pipes tables, - lists, > quotes,
// **bold**, _italic_, `code`). No HTML passthrough.

interface InlineCtx {
  text: string;
  keyPrefix: string;
}

function renderInline(ctx: InlineCtx): ReactNode {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(ctx.text)) !== null) {
    if (m.index > last) out.push(ctx.text.slice(last, m.index));
    const token = m[0];
    const inner = token.slice(2, -2);
    if (token.startsWith("**")) out.push(<strong key={i}>{inner}</strong>);
    else if (token.startsWith("_")) out.push(<em key={i}>{inner}</em>);
    else out.push(<code key={i} className="rounded bg-surface-subtle px-1 text-xs">{inner}</code>);
    last = m.index + token.length;
    i++;
  }
  if (last < ctx.text.length) out.push(ctx.text.slice(last));
  return <Fragment>{out}</Fragment>;
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let buf = "";
  for (let k = 0; k < line.length; k++) {
    if (line[k] === "\\" && line[k + 1] === "|") {
      buf += "|";
      k++;
    } else if (line[k] === "|") {
      cells.push(buf.trim());
      buf = "";
    } else {
      buf += line[k];
    }
  }
  cells.push(buf.trim());
  return cells;
}

export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let tblBuf: string[] = [];

  const flushTable = (key: string) => {
    if (tblBuf.length < 2) {
      blocks.push(
        <p key={key} className="my-1 whitespace-pre-wrap">
          {tblBuf.join("\n")}
        </p>,
      );
    } else {
      const header = splitTableRow(tblBuf[0]);
      const body = tblBuf.slice(2).map(splitTableRow);
      blocks.push(
        <div key={key} className="my-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {header.map((h, hi) => (
                  <th key={hi} className="px-3 py-1.5">
                    {renderInline({ text: h, keyPrefix: `th${hi}` })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {body.map((row, ri) => (
                <tr key={ri} className="transition-colors hover:bg-surface-subtle/40">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 tabular-nums">
                      {renderInline({ text: cell, keyPrefix: `td${ri}-${ci}` })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    tblBuf = [];
  };

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("|")) {
      tblBuf.push(line);
      continue;
    }
    if (tblBuf.length > 0) flushTable(`tbl-${i}`);
    if (!line.trim()) continue;

    if (/^### /.test(line)) {
      blocks.push(
        <h3 key={i} className="mt-3 text-sm font-semibold text-foreground">
          {renderInline({ text: line.slice(4), keyPrefix: `h3-${i}` })}
        </h3>,
      );
    } else if (/^## /.test(line)) {
      blocks.push(
        <h2 key={i} className="mt-4 border-b border-border/60 pb-1 text-base font-semibold text-foreground">
          {renderInline({ text: line.slice(3), keyPrefix: `h2-${i}` })}
        </h2>,
      );
    } else if (/^# /.test(line)) {
      blocks.push(
        <h1 key={i} className="mt-2 text-lg font-semibold text-foreground">
          {renderInline({ text: line.slice(2), keyPrefix: `h1-${i}` })}
        </h1>,
      );
    } else if (/^- /.test(line)) {
      const items: ReactNode[] = [];
      let j = i;
      while (j < lines.length && /^- /.test(lines[j])) {
        items.push(
          <li key={j} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand" />
            <span>{renderInline({ text: lines[j].slice(2), keyPrefix: `li-${j}` })}</span>
          </li>,
        );
        j++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-1 space-y-0.5">
          {items}
        </ul>,
      );
      i = j - 1;
    } else if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      let j = i;
      while (j < lines.length && /^\d+\. /.test(lines[j])) {
        items.push(
          <li key={j} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-muted">{lines[j].split(".")[0]}</span>
            <span>{renderInline({ text: lines[j].replace(/^\d+\. /, ""), keyPrefix: `ol-${j}` })}</span>
          </li>,
        );
        j++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-1 list-decimal space-y-0.5 [counter-reset:none]">
          {items}
        </ol>,
      );
      i = j - 1;
    } else if (/^&gt; /.test(line) || line.startsWith("> ")) {
      const quotes: ReactNode[] = [];
      let j = i;
      while (j < lines.length && lines[j].startsWith("> ")) {
        quotes.push(
          <p key={j}>{renderInline({ text: lines[j].slice(2), keyPrefix: `q-${j}` })}</p>,
        );
        j++;
      }
      blocks.push(
        <blockquote key={`bq-${i}`} className="my-1 border-l-2 border-brand/50 pl-3 text-muted">
          {quotes}
        </blockquote>,
      );
      i = j - 1;
    } else {
      blocks.push(
        <p key={i} className="my-1 whitespace-pre-wrap text-sm text-foreground">
          {renderInline({ text: line, keyPrefix: `p-${i}` })}
        </p>,
      );
    }
  }
  if (tblBuf.length > 0) flushTable(`tbl-end`);

  return (
    <div className={cn("min-w-0 space-y-0.5 text-sm", className)}>{blocks}</div>
  );
}