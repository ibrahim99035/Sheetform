import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface RichTextNode {
  type?: string;
  text?: string;
  content?: RichTextNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function RenderNodes({ nodes }: { nodes: RichTextNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <RenderNode key={i} node={node} />
      ))}
    </>
  );
}

function RenderNode({ node }: { node: RichTextNode }) {
  const text = node.text;
  const children = Array.isArray(node.content)
    ? <RenderNodes nodes={node.content} />
    : null;

  switch (node.type) {
    case "paragraph":
      return <p className="my-1">{children ?? <span>{text ?? ""}</span>}</p>;
    case "heading":
      return <h2 className="mt-3 mb-1 text-base font-semibold text-foreground">{children ?? <span>{text ?? ""}</span>}</h2>;
    case "bulletList":
      return <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>;
    case "orderedList":
      return <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "hardBreak":
      return <br />;
    case "text": {
      let el: ReactNode = <span>{text ?? ""}</span>;
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") el = <strong>{el}</strong>;
        else if (mark.type === "italic") el = <em>{el}</em>;
        else if (mark.type === "strike") el = <s>{el}</s>;
        else if (mark.type === "code") el = <code className="rounded bg-surface-subtle px-1 text-xs">{el}</code>;
      }
      return <>{el}</>;
    }
    default:
      return <>{children ?? (text ?? "")}</>;
  }
}

export function RichTextView({
  doc,
  className,
}: {
  doc: RichTextNode;
  className?: string;
}) {
  return (
    <div className={cn("whitespace-pre-wrap text-sm text-foreground", className)}>
      <RenderNodes nodes={doc.content ?? []} />
    </div>
  );
}