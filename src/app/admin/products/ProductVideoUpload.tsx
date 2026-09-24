"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { registerProductVideo } from "./actions";

type ProductVideoUploadProps = {
  productId: string;
};

export default function ProductVideoUpload({
  productId,
}: ProductVideoUploadProps) {
  const router = useRouter();

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const videoValue = formData.get("video");

    if (
      !(videoValue instanceof File) ||
      videoValue.size === 0
    ) {
      setMessage("Lütfen bir video seçin.");
      return;
    }

    const allowedVideoTypes = [
      "video/mp4",
      "video/webm",
    ];

    if (!allowedVideoTypes.includes(videoValue.type)) {
      setMessage(
        "Sadece MP4 veya WEBM video yüklenebilir."
      );
      return;
    }

    const maxVideoSize = 50 * 1024 * 1024;

    if (videoValue.size > maxVideoSize) {
      setMessage("Video en fazla 50 MB olabilir.");
      return;
    }

    setUploading(true);
    setMessage(null);

    const extensionByMimeType: Record<string, string> = {
      "video/mp4": "mp4",
      "video/webm": "webm",
    };

    const extension =
      extensionByMimeType[videoValue.type];

    const storagePath =
      `${productId}/${crypto.randomUUID()}.${extension}`;

    const supabase = createClient();

    const { error: uploadError } =
      await supabase.storage
        .from("product-media")
        .upload(storagePath, videoValue, {
          contentType: videoValue.type,
          upsert: false,
        });

    if (uploadError) {
      setUploading(false);
      setMessage("Video yüklenemedi.");
      return;
    }

    try {
      const registerFormData = new FormData();

      registerFormData.set("productId", productId);
      registerFormData.set(
        "storagePath",
        storagePath
      );
      registerFormData.set(
        "originalName",
        videoValue.name
      );
      registerFormData.set(
        "mimeType",
        videoValue.type
      );

      await registerProductVideo(registerFormData);

      form.reset();
      setMessage("Video başarıyla yüklendi.");
      router.refresh();
    } catch {
      setMessage(
        "Video yüklendi ancak ürüne bağlanamadı."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 space-y-3 rounded-lg border border-zinc-800 p-4"
    >
      <div>
        <label className="block text-sm font-medium">
          Ürün videosu
        </label>

        <input
          type="file"
          name="video"
          accept="video/mp4,video/webm"
          required
          disabled={uploading}
          className="mt-2 block"
        />

        <p className="mt-2 text-sm text-zinc-400">
          MP4 veya WEBM. En fazla 50 MB.
        </p>
      </div>

      <button
        type="submit"
        disabled={uploading}
        className="rounded-lg bg-white px-5 py-2 font-semibold text-black disabled:opacity-50"
      >
        {uploading
          ? "Video yükleniyor..."
          : "Video Yükle"}
      </button>

      {message && (
        <p className="text-sm text-zinc-300">
          {message}
        </p>
      )}
    </form>
  );
}