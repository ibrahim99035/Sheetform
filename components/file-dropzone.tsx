"use client";

import { useCallback, useRef, useState } from "react";

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
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition ${
          disabled
            ? "border-neutral-200 bg-neutral-50"
            : dragging
              ? "border-neutral-900 bg-neutral-100"
              : "border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50"
        }`}
      >
        <p className="text-base font-medium text-neutral-800">Drop a file here</p>
        <p className="mt-1 text-sm text-neutral-500">
          or click to browse · .csv, .xlsx
        </p>
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}