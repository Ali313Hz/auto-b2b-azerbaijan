"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import ConfirmForm from "@/components/ConfirmForm";
import CategoryThumb from "@/components/CategoryThumb";
import type { ActionResult } from "@/lib/action-result";

import MediaDropZone from "../products/MediaDropZone";
import { createThumbnail, imageAccept, imageProblem } from "../products/media-upload";

import { removeCategoryImage, uploadCategoryImage } from "./actions";

// Image of one category: preview, pick / drop a new one, upload, remove.
export default function CategoryImageEditor({
  categoryId,
  name,
  imageUrl,
}: {
  categoryId: string;
  name: string;
  imageUrl: string | null;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<ActionResult>(null);

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  function pick(files: File[]) {
    const file = files[0];
    const problem = file ? imageProblem(file) : "Şəkil seçin.";

    if (problem || !file) {
      setMessage({ ok: false, message: problem ?? "Şəkil seçin." });
      return;
    }

    setMessage(null);
    setPicked({ file, url: URL.createObjectURL(file) });
  }

  async function upload() {
    if (!picked || busy.current) {
      return;
    }

    busy.current = true;
    setUploading(true);

    const formData = new FormData();

    formData.set("categoryId", categoryId);
    formData.set("image", picked.file);

    try {
      const thumbnail = await createThumbnail(picked.file);

      if (thumbnail) formData.set("thumbnail", thumbnail);
    } catch {
      // The original image is used when no small copy can be made.
    }

    let result: ActionResult;

    try {
      result = await uploadCategoryImage(null, formData);
    } catch {
      result = { ok: false, message: "Şəkil yüklənmədi. İnternet bağlantısını yoxlayın." };
    }

    setMessage(result);

    if (result?.ok) {
      setPicked(null);
      router.refresh();
    }

    setUploading(false);
    busy.current = false;
  }

  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <CategoryThumb
          url={picked?.url ?? imageUrl}
          name={name}
          className="aspect-[4/3] w-full"
          letterClassName="text-4xl"
        />
      </div>

      <div className="min-w-0 space-y-3">
        <p className="text-sm text-zinc-400">
          Şəkil müştərilərin kataloqunda kateqoriya kartında görünür. Şəkil
          məcburi deyil — şəkilsiz kateqoriyada adın ilk hərfi göstərilir.
        </p>

        {picked ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={uploading}
              aria-busy={uploading}
              onClick={upload}
              className="btn btn-primary"
            >
              {uploading ? "Yüklənir..." : "Şəkli yadda saxla"}
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => setPicked(null)}
              className="btn btn-secondary"
            >
              İmtina
            </button>
          </div>
        ) : (
          <MediaDropZone
            id={`category-image-${categoryId}`}
            title={imageUrl ? "Şəkli dəyiş" : "Şəkil əlavə et"}
            hint="Şəkli bura sürüşdürün və ya seçin. JPG, PNG, WEBP · maksimum 5 MB."
            accept={imageAccept}
            disabled={uploading}
            onFiles={pick}
          />
        )}

        {imageUrl && !picked && (
          <ConfirmForm
            action={removeCategoryImage}
            fields={{ categoryId }}
            label="Şəkli sil"
            question="Kateqoriyanın şəklini silmək istəyirsiniz?"
            description="Kateqoriya qalır, sadəcə şəkilsiz göstəriləcək."
            confirmLabel="Bəli, sil"
            pendingText="Silinir..."
            tone="danger"
            className="w-full sm:w-auto"
          />
        )}

        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-emerald-400" : "text-red-400"}`}>
            {message.message}
          </p>
        )}
      </div>
    </div>
  );
}
