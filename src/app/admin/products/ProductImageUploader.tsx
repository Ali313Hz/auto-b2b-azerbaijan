"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import MediaDropZone from "./MediaDropZone";
import { formatFileSize, imageAccept, imageProblem, uploadImageFile } from "./media-upload";

type Picked = { key: string; file: File; url: string };

// Edit screen: add several images at once with instant previews. Each image
// is uploaded separately with its small catalog copy.
export default function ProductImageUploader({ productId }: { productId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);

  function addFiles(files: File[]) {
    const problems: string[] = [];
    const accepted: Picked[] = [];

    for (const file of files) {
      const problem = imageProblem(file);

      if (problem) {
        problems.push(`${file.name}: ${problem}`);
      } else {
        accepted.push({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
      }
    }

    setMessage(problems.length ? { ok: false, lines: problems } : null);
    setPicked((current) => [...current, ...accepted]);
  }

  function remove(key: string) {
    setPicked((current) => {
      const item = current.find((entry) => entry.key === key);

      if (item) URL.revokeObjectURL(item.url);

      return current.filter((entry) => entry.key !== key);
    });
  }

  async function uploadAll() {
    if (busy.current || picked.length === 0) {
      return;
    }

    busy.current = true;
    setMessage(null);

    const failed: Picked[] = [];
    const problems: string[] = [];

    for (const [index, item] of picked.entries()) {
      setProgress(`Yüklənir (${index + 1}/${picked.length})...`);

      const result = await uploadImageFile(productId, item.file);

      if (result?.ok) {
        URL.revokeObjectURL(item.url);
      } else {
        failed.push(item);
        problems.push(`${item.file.name}: ${result?.message ?? "Şəkil yüklənmədi."}`);
      }
    }

    // Failed images stay in the list so they can be tried again.
    setPicked(failed);
    setProgress(null);
    setMessage(
      problems.length
        ? { ok: false, lines: problems }
        : { ok: true, lines: ["Şəkillər yükləndi."] }
    );
    busy.current = false;
    router.refresh();
  }

  const uploading = progress !== null;

  return (
    <div className="space-y-3">
      <MediaDropZone
        id={`images-${productId}`}
        title="Şəkil əlavə et"
        hint="Şəkilləri bura sürüşdürün və ya seçin. JPG, PNG, WEBP · maksimum 5 MB."
        accept={imageAccept}
        multiple
        disabled={uploading}
        onFiles={addFiles}
      />

      {picked.length > 0 && (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {picked.map((item) => (
              <li key={item.key} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.file.name} className="aspect-square w-full object-contain p-1" />
                <div className="border-t border-zinc-800 p-1.5">
                  <p className="truncate text-[11px] text-zinc-500" title={item.file.name}>
                    {formatFileSize(item.file.size)}
                  </p>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => remove(item.key)}
                    className="btn btn-danger btn-sm mt-1 w-full"
                  >
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={uploading}
            aria-busy={uploading}
            onClick={uploadAll}
            className="btn btn-primary w-full sm:w-auto"
          >
            {progress ?? `${picked.length} şəkli yüklə`}
          </button>
        </>
      )}

      {message && (
        <ul
          role={message.ok ? "status" : "alert"}
          className={`space-y-1 text-sm ${message.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {message.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
