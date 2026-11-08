// Browser-side helpers shared by the product create and edit screens.
// Images go through the uploadProductImage server action (type and size are
// checked again on the server); videos go straight to the private storage
// bucket (storage policies limit who may write) and are then registered.

import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/client";

import { registerProductVideo, uploadProductImage } from "./actions";

const THUMB_WIDTH = 480;
const THUMB_QUALITY = 0.8;

export const imageAccept = "image/jpeg,image/png,image/webp";
export const videoAccept = "video/mp4,video/webm";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoExtensions: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const maxImageSize = 5 * 1024 * 1024;
const maxVideoSize = 50 * 1024 * 1024;

export function imageProblem(file: File) {
  if (!imageTypes.has(file.type)) {
    return "Yalnız JPG, PNG və ya WEBP şəkil əlavə etmək olar.";
  }

  if (file.size > maxImageSize) {
    return "Şəklin həcmi 5 MB-dan çox ola bilməz.";
  }

  return null;
}

export function videoProblem(file: File) {
  if (!videoExtensions[file.type]) {
    return "Yalnız MP4 və ya WEBM video əlavə etmək olar.";
  }

  if (file.size > maxVideoSize) {
    return "Videonun həcmi 50 MB-dan çox ola bilməz.";
  }

  return null;
}

export function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Small WebP copy for catalog cards and lists, made with a canvas (no extra
// package). The original is still uploaded for the product page.
export async function createThumbnail(file: File) {
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

export async function uploadImageFile(
  productId: string,
  file: File
): Promise<ActionResult> {
  const formData = new FormData();

  formData.set("productId", productId);
  formData.set("image", file);

  try {
    const thumbnail = await createThumbnail(file);

    if (thumbnail) {
      formData.set("thumbnail", thumbnail);
    }
  } catch {
    // Without a thumbnail the catalog falls back to the original image.
  }

  try {
    return await uploadProductImage(null, formData);
  } catch {
    return { ok: false, message: "Şəkil yüklənmədi. İnternet bağlantısını yoxlayın." };
  }
}

export async function uploadVideoFile(
  productId: string,
  file: File
): Promise<ActionResult> {
  const problem = videoProblem(file);

  if (problem) {
    return { ok: false, message: problem };
  }

  const storagePath = `${productId}/${crypto.randomUUID()}.${videoExtensions[file.type]}`;
  const supabase = createClient();

  const { error: uploadError } = await supabase.storage
    .from("product-media")
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { ok: false, message: "Video yaddaşa yüklənmədi." };
  }

  try {
    const formData = new FormData();

    formData.set("productId", productId);
    formData.set("storagePath", storagePath);
    formData.set("originalName", file.name);
    formData.set("mimeType", file.type);

    await registerProductVideo(formData);

    return { ok: true, message: "Video yükləndi." };
  } catch {
    return { ok: false, message: "Video yükləndi, lakin məhsula bağlanmadı." };
  }
}
