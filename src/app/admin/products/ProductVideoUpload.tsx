"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { registerProductVideo } from "./actions";

type ProductVideoUploadProps = {
  productId: string;
};

const extensionByMimeType: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const maxVideoSize = 50 * 1024 * 1024;

export default function ProductVideoUpload({
  productId,
}: ProductVideoUploadProps) {
  const router = useRouter();

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (uploading) {
      return;
    }

    const form = event.currentTarget;
    const videoValue = new FormData(form).get("video");

    if (!(videoValue instanceof File) || videoValue.size === 0) {
      setMessage({ ok: false, text: "Video seçin." });
      return;
    }

    const extension = extensionByMimeType[videoValue.type];

    if (!extension) {
      setMessage({
        ok: false,
        text: "Yalnız MP4 və ya WEBM video yükləmək olar.",
      });
      return;
    }

    if (videoValue.size > maxVideoSize) {
      setMessage({
        ok: false,
        text: "Videonun həcmi 50 MB-dan çox ola bilməz.",
      });
      return;
    }

    setUploading(true);
    setMessage(null);

    const storagePath = `${productId}/${crypto.randomUUID()}.${extension}`;

    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from("product-media")
      .upload(storagePath, videoValue, {
        contentType: videoValue.type,
        upsert: false,
      });

    if (uploadError) {
      setUploading(false);
      setMessage({ ok: false, text: "Video yaddaşa yüklənmədi." });
      return;
    }

    try {
      const registerFormData = new FormData();

      registerFormData.set("productId", productId);
      registerFormData.set("storagePath", storagePath);
      registerFormData.set("originalName", videoValue.name);
      registerFormData.set("mimeType", videoValue.type);

      await registerProductVideo(registerFormData);

      form.reset();
      setMessage({ ok: true, text: "Video yükləndi." });
      router.refresh();
    } catch {
      setMessage({
        ok: false,
        text: "Video yükləndi, lakin məhsula bağlanmadı. Yenidən cəhd edin.",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={`video-${productId}`} className="label">
          Yeni video
        </label>

        <input
          id={`video-${productId}`}
          type="file"
          name="video"
          accept="video/mp4,video/webm"
          required
          disabled={uploading}
          className="input file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-zinc-200"
        />
      </div>

      <button
        type="submit"
        disabled={uploading}
        aria-busy={uploading}
        className="btn btn-primary"
      >
        {uploading ? "Yüklənir..." : "Video yüklə"}
      </button>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`basis-full text-sm ${
            message.ok ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
