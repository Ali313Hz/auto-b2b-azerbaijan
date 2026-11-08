"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import MediaDropZone from "./MediaDropZone";
import { formatFileSize, uploadVideoFile, videoAccept, videoProblem } from "./media-upload";

type Picked = { file: File; url: string };

export default function ProductVideoUpload({ productId }: { productId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function choose(files: File[]) {
    const file = files[0];
    const problem = videoProblem(file);

    if (picked) URL.revokeObjectURL(picked.url);

    if (problem) {
      setPicked(null);
      setMessage({ ok: false, text: `${file.name}: ${problem}` });
      return;
    }

    setMessage(null);
    setPicked({ file, url: URL.createObjectURL(file) });
  }

  function clear() {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(null);
  }

  async function upload() {
    if (busy.current || !picked) {
      return;
    }

    busy.current = true;
    setUploading(true);
    setMessage(null);

    const result = await uploadVideoFile(productId, picked.file);

    if (result?.ok) {
      clear();
      router.refresh();
    }

    setMessage({ ok: Boolean(result?.ok), text: result?.message ?? "Video yüklənmədi." });
    setUploading(false);
    busy.current = false;
  }

  return (
    <div className="space-y-3">
      <MediaDropZone
        id={`video-${productId}`}
        title="Video əlavə et"
        hint="MP4 və ya WEBM · maksimum 50 MB."
        accept={videoAccept}
        disabled={uploading}
        onFiles={choose}
      />

      {picked && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-2">
          <video
            src={picked.url}
            muted
            playsInline
            preload="metadata"
            className="h-16 w-24 shrink-0 rounded bg-black object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-200" title={picked.file.name}>
              {picked.file.name}
            </p>
            <p className="text-xs text-zinc-500">{formatFileSize(picked.file.size)}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={uploading} onClick={clear} className="btn btn-secondary btn-sm">
              Ləğv et
            </button>
            <button
              type="button"
              disabled={uploading}
              aria-busy={uploading}
              onClick={upload}
              className="btn btn-primary btn-sm"
            >
              {uploading ? "Yüklənir..." : "Videonu yüklə"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
