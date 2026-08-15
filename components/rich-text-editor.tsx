"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { JSONContent } from "@tiptap/core";
import { Bold, Heading2, Italic, List, ListOrdered, Undo, Redo } from "lucide-react";
import { cn } from "@/lib/cn";

export type RichTextDoc = JSONContent;

export function emptyRichTextDoc(): RichTextDoc {
  return { type: "doc", content: [] };
}

interface ToolbarButtonProps {
  on?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ on = false, disabled, label, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-surface-subtle hover:text-foreground",
        on && "bg-brand-subtle text-brand",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: RichTextDoc | null;
  onChange: (doc: RichTextDoc) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: placeholder ?? "Write something…" })],
    content: (value ?? emptyRichTextDoc()) as JSONContent,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as RichTextDoc;
      onChange(json);
    },
  });

  // Sync external resets (e.g. "clear" or switching drafts).
  useEffect(() => {
    if (!editor || !value) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(value);
    if (current !== next) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong focus-within:border-brand">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-subtle/40 px-2 py-1.5">
        <ToolbarButton
          on={editor.isActive("bold")}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive("italic")}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive("heading", { level: 2 })}
          label="Heading"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive("bulletList")}
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          on={editor.isActive("orderedList")}
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <style>{`.tiptap-editor { padding: 0.625rem 0.75rem; min-height: 120px; font-size: 0.875rem; color: var(--text-foreground); outline: none; } .tiptap-editor p { margin: 0.25rem 0; } .tiptap-editor h2 { font-weight: 600; margin: 0.5rem 0 0.25rem; } .tiptap-editor ul, .tiptap-editor ol { padding-left: 1.25rem; margin: 0.25rem 0; } .tiptap-editor ul { list-style: disc; } .tiptap-editor ol { list-style: decimal; } .tiptap-editor p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: var(--color-faint, #9ca3af); pointer-events: none; height: 0; }`}</style>
      <EditorContent editor={editor} className="tiptap-editor" />
    </div>
  );
}