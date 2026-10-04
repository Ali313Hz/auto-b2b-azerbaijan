"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

async function getAuthedClient() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return supabase;
}

function revalidateProductPaths(productId?: string) {
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
  revalidatePath("/cart");

  if (productId) {
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/products/${productId}`);
  }
}

function readText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : null;
}

function parseStockAndPrices(formData: FormData) {
  const values = {
    stock: readText(formData, "stock"),
    normalPrice: readText(formData, "normalPrice"),
    dealerPrice: readText(formData, "dealerPrice"),
    vipPrice: readText(formData, "vipPrice"),
  };

  if (Object.values(values).some((value) => !value)) {
    return null;
  }

  const stock = Number(values.stock);
  const prices = [
    Number(values.normalPrice),
    Number(values.dealerPrice),
    Number(values.vipPrice),
  ];

  if (
    !Number.isInteger(stock) ||
    stock < 0 ||
    prices.some((price) => !Number.isFinite(price) || price < 0)
  ) {
    return null;
  }

  return {
    stock,
    normalPrice: prices[0],
    dealerPrice: prices[1],
    vipPrice: prices[2],
  };
}

export async function createProduct(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const sku = readText(formData, "sku");
  const name = readText(formData, "name");
  const description = readText(formData, "description") ?? "";
  const categoryId = readText(formData, "categoryId");
  const activeValue = readText(formData, "active");
  const numbers = parseStockAndPrices(formData);

  if (!sku || !name || !categoryId) {
    return fail("Ad, SKU və kateqoriya mütləqdir.");
  }

  if (!numbers) {
    return fail("Stok tam ədəd, qiymətlər isə 0 və ya daha böyük olmalıdır.");
  }

  if (activeValue !== "true" && activeValue !== "false") {
    return fail("Status yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { data: productId, error } = await supabase.rpc(
    "create_admin_product",
    {
      p_sku: sku,
      p_category_id: categoryId,
      p_stock: numbers.stock,
      p_normal_price: numbers.normalPrice,
      p_dealer_price: numbers.dealerPrice,
      p_vip_price: numbers.vipPrice,
      p_active: activeValue === "true",
    }
  );

  if (error || !productId) {
    return fail(dbErrorMessage(error, "Məhsul yaradılmadı."));
  }

  const { error: contentError } = await supabase.rpc(
    "update_admin_product_content",
    {
      p_product_id: productId,
      p_name: name,
      p_description: description,
      p_category_id: categoryId,
    }
  );

  revalidateProductPaths(productId);

  if (contentError) {
    redirect(`/admin/products/${productId}?notice=content-failed`);
  }

  redirect(`/admin/products/${productId}?notice=created`);
}

export async function updateProduct(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = readText(formData, "productId");
  const numbers = parseStockAndPrices(formData);

  if (!productId) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  if (!numbers) {
    return fail("Stok tam ədəd, qiymətlər isə 0 və ya daha böyük olmalıdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_product", {
    p_product_id: productId,
    p_stock: numbers.stock,
    p_normal_price: numbers.normalPrice,
    p_dealer_price: numbers.dealerPrice,
    p_vip_price: numbers.vipPrice,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Stok və qiymətlər yenilənmədi."));
  }

  revalidateProductPaths(productId);

  return ok("Stok və qiymətlər yadda saxlandı.");
}

export async function updateProductActive(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = readText(formData, "productId");
  const activeValue = readText(formData, "active");

  if (!productId || (activeValue !== "true" && activeValue !== "false")) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_product_active", {
    p_product_id: productId,
    p_active: activeValue === "true",
  });

  if (error) {
    return fail(dbErrorMessage(error, "Məhsulun statusu dəyişdirilmədi."));
  }

  revalidateProductPaths(productId);

  return ok(
    activeValue === "true"
      ? "Məhsul satışa çıxarıldı."
      : "Məhsul satışdan çıxarıldı."
  );
}

export async function updateProductContent(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = readText(formData, "productId");
  const name = readText(formData, "name");
  const description = readText(formData, "description") ?? "";
  const categoryId = readText(formData, "categoryId");

  if (!productId || !categoryId) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  if (!name) {
    return fail("Məhsul adı mütləqdir.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_product_content", {
    p_product_id: productId,
    p_name: name,
    p_description: description,
    p_category_id: categoryId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Məhsul məlumatları yenilənmədi."));
  }

  revalidateProductPaths(productId);

  return ok("Məhsul məlumatları yadda saxlandı.");
}

const allowedImageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const maxImageSize = 5 * 1024 * 1024;

export async function uploadProductImage(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = readText(formData, "productId");
  const imageValue = formData.get("image");

  if (!productId) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  if (!(imageValue instanceof File) || imageValue.size === 0) {
    return fail("Şəkil seçin.");
  }

  const extension = allowedImageTypes[imageValue.type];

  if (!extension) {
    return fail("Yalnız JPG, PNG və ya WEBP şəkil yükləmək olar.");
  }

  if (imageValue.size > maxImageSize) {
    return fail("Şəklin həcmi 5 MB-dan çox ola bilməz.");
  }

  const supabase = await getAuthedClient();

  const storagePath = `${productId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("product-media")
    .upload(storagePath, imageValue, {
      contentType: imageValue.type,
      upsert: false,
    });

  if (uploadError) {
    return fail("Şəkil yaddaşa yüklənmədi.");
  }

  const { error: mediaError } = await supabase.rpc(
    "create_admin_product_media",
    {
      p_product_id: productId,
      p_media_type: "IMAGE",
      p_storage_path: storagePath,
      p_original_name: imageValue.name,
      p_mime_type: imageValue.type,
    }
  );

  if (mediaError) {
    await supabase.storage.from("product-media").remove([storagePath]);

    return fail(dbErrorMessage(mediaError, "Şəkil məhsula bağlanmadı."));
  }

  revalidateProductPaths(productId);

  return ok("Şəkil yükləndi.");
}

export async function setProductPrimaryImage(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const mediaId = readText(formData, "mediaId");
  const productId = readText(formData, "productId") ?? undefined;

  if (!mediaId) {
    return fail("Şəkil məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("set_admin_product_primary_media", {
    p_media_id: mediaId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Əsas şəkil dəyişdirilmədi."));
  }

  revalidateProductPaths(productId);

  return ok("Əsas şəkil dəyişdirildi.");
}

async function deleteProductMedia(
  formData: FormData,
  labels: { invalid: string; failed: string; storage: string; done: string }
): Promise<ActionResult> {
  const mediaId = readText(formData, "mediaId");
  const productId = readText(formData, "productId") ?? undefined;

  if (!mediaId) {
    return fail(labels.invalid);
  }

  const supabase = await getAuthedClient();

  const { data: storagePath, error: deleteError } = await supabase.rpc(
    "delete_admin_product_media",
    { p_media_id: mediaId }
  );

  if (deleteError || !storagePath) {
    return fail(dbErrorMessage(deleteError, labels.failed));
  }

  const { error: storageError } = await supabase.storage
    .from("product-media")
    .remove([storagePath]);

  revalidateProductPaths(productId);

  if (storageError) {
    return fail(labels.storage);
  }

  return ok(labels.done);
}

export async function deleteProductImage(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  return deleteProductMedia(formData, {
    invalid: "Şəkil məlumatı yanlışdır.",
    failed: "Şəkil silinmədi.",
    storage: "Şəkil qeydi silindi, lakin fayl yaddaşdan təmizlənmədi.",
    done: "Şəkil silindi.",
  });
}

export async function deleteProductVideo(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  return deleteProductMedia(formData, {
    invalid: "Video məlumatı yanlışdır.",
    failed: "Video silinmədi.",
    storage: "Video qeydi silindi, lakin fayl yaddaşdan təmizlənmədi.",
    done: "Video silindi.",
  });
}

export async function registerProductVideo(formData: FormData) {
  const productId = readText(formData, "productId");
  const storagePath = readText(formData, "storagePath");
  const originalName = readText(formData, "originalName") ?? "";
  const mimeType = readText(formData, "mimeType");

  if (!productId || !storagePath || !mimeType) {
    throw new Error("Invalid video data");
  }

  if (!["video/mp4", "video/webm"].includes(mimeType)) {
    throw new Error("Invalid video type");
  }

  const supabase = await getAuthedClient();

  const { error: mediaError } = await supabase.rpc(
    "create_admin_product_media",
    {
      p_product_id: productId,
      p_media_type: "VIDEO",
      p_storage_path: storagePath,
      p_original_name: originalName,
      p_mime_type: mimeType,
    }
  );

  if (mediaError) {
    await supabase.storage.from("product-media").remove([storagePath]);

    throw new Error("Video registration failed");
  }

  revalidateProductPaths(productId);
}
