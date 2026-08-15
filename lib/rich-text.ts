/** Convert a TipTap JSON doc (or a plain string) to plain text — for PDFs,
 *  emails, and WhatsApp delivery bodies. Pure module, safe on server & edge. */
export function richTextToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const doc = value as { type?: string; text?: string; content?: unknown[] };
  if (typeof doc.text === "string") return doc.text;
  if (!Array.isArray(doc.content)) return "";
  const parts: string[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const n = node as { type?: string; content?: unknown[]; text?: string };
    const blockSeparator = n.type === "paragraph" || n.type === "heading" ? "\n" : "";
    if (typeof n.text === "string") {
      parts.push(n.text);
    }
    if (Array.isArray(n.content)) {
      parts.push(richTextToText(n));
    }
    if (blockSeparator) parts.push("\n");
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}