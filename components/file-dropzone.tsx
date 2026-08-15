"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_FILE_SIZE } from "@/lib/constants";

interface FileDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  accepted?: string;
}

export function FileDropzone({ onFile, disabled, accepted = ".csv,.xlsx,.xls" }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const okExt = /\.(csv|xlsx|xls)$/i.test(file.name);
      if (!okExt) {
        setError("Unsupported file type. Please upload a .csv or .xlsx file.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("This file exceeds the 25 MB size limit.");
        return;
      }
      setError(null);
      onFile(file);
    },
    [onFile],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200 sm:py-16",
          disabled
            ? "border-border bg-surface-subtle"
            : dragging
              ? "scale-[1.005] border-brand bg-brand-subtle"
              : "border-border-strong bg-surface hover:border-brand/60 hover:bg-surface-subtle/60",
        )}
      >
        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200",
            dragging
              ? "scale-110 bg-brand text-brand-contrast"
              : "bg-brand-subtle text-brand group-hover:scale-105",
          )}
        >
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-base font-medium text-foreground">Drop your file here</p>
        <p className="mt-1 text-sm text-muted">or click to browse · .csv, .xlsx</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accepted}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
