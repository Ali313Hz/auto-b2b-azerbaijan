"use client";

import { ChangeEvent, useRef, useState } from "react";

const THUMB_WIDTH = 480;
const THUMB_QUALITY = 0.8;

// Creates a small WebP copy for catalog cards in the browser (canvas, no
// extra package). The original is still uploaded for the product page.
async function createThumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", THUMB_QUALITY)
  );

  return blob && blob.type === "image/webp"
    ? new File([blob], "thumbnail.webp", { type: "image/webp" })
    : null;
}

export default function ImageFileInput() {
  const thumbnailRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const target = thumbnailRef.current;

    if (!target) {
      return;
    }

    target.value = "";

    if (!file) {
      return;
    }

    setPreparing(true);

    try {
      const thumbnail = await createThumbnail(file);

      if (thumbnail) {
        const transfer = new DataTransfer();
        transfer.items.add(thumbnail);
        target.files = transfer.files;
      }
    } catch {
      // Without a thumbnail the catalog falls back to the original image.
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <label htmlFor="image" className="label">
        Yeni şəkil {preparing && <span className="text-zinc-500">(kiçik versiya hazırlanır...)</span>}
      </label>
      <input
        id="image"
        type="file"
        name="image"
        accept="image/jpeg,image/png,image/webp"
        required
        onChange={handleChange}
        className="input file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-zinc-200"
      />
      <input ref={thumbnailRef} type="file" name="thumbnail" accept="image/webp" hidden tabIndex={-1} />
    </div>
  );
}
