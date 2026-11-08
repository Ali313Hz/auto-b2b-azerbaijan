"use client";

import { DragEvent, useRef, useState } from "react";

type MediaDropZoneProps = {
  id: string;
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
};

// Drag & drop area that also opens the normal file picker on click or tap.
export default function MediaDropZone({
  id,
  title,
  hint,
  accept,
  multiple = false,
  disabled = false,
  onFiles,
}: MediaDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);

    if (disabled) {
      return;
    }

    const files = Array.from(event.dataTransfer.files);

    if (files.length > 0) {
      onFiles(multiple ? files : files.slice(0, 1));
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition ${
        over ? "border-amber-500 bg-amber-950/20" : "border-zinc-700 bg-zinc-950/50"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="btn btn-secondary"
      >
        + {title}
      </button>
      <p className="text-sm text-zinc-400">{hint}</p>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);

          event.target.value = "";

          if (files.length > 0) {
            onFiles(files);
          }
        }}
      />
    </div>
  );
}
