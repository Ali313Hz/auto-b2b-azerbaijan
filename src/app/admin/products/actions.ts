"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import { uuidPattern } from "@/lib/format";
import { thumbnailPathFor } from "@/lib/media";
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

function readMoney(formData: FormData, key: string) {
  const text = (readText(formData, key) ?? "").replace(",", ".");

  if (text === "") {
    return null;
  }

  const value = Number(text);

  return Number.isFinite(value) && value >= 0 && value <= 100_000_000
    ? Math.round(value * 100) / 100
    : NaN;
}

// Stock + prices from ProductPriceFields. NORMAL is required; dealer / VIP
// only when "Diler və VIP qiymətləri əlavə et" is ticked, the sale price
// only when "Bu məhsul endirimdədir" is ticked. Unticked = NULL (not set).
function parseStockAndPrices(
  formData: FormData
): { ok: true; value: {
  stock: number;
  normalPrice: number;
  dealerPrice: number | null;
  vipPrice: number | null;
  salePrice: number | null;
} } | { ok: false; message: string } {
  const stock = Number(readText(formData, "stock"));
  const normalPrice = readMoney(formData, "normalPrice");
  const groupPrices = readText(formData, "groupPrices") === "1";
  const onSale = readText(formData, "onSale") === "1";
  const dealerPrice = groupPrices ? readMoney(formData, "dealerPrice") : null;
  const vipPrice = groupPrices ? readMoney(formData, "vipPrice") : null;
  const salePrice = onSale ? readMoney(formData, "salePrice") : null;

  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
    return { ok: false, message: "Stok 0 və ya daha böyük tam ədəd olmalıdır." };
  }

  if (normalPrice === null || Number.isNaN(normalPrice)) {
    return { ok: false, message: "Normal qiyməti yazın (0 və ya daha böyük)." };
  }

  if (groupPrices && (dealerPrice === null || vipPrice === null || Number.isNaN(dealerPrice) || Number.isNaN(vipPrice))) {
    return { ok: false, message: "Diler və VIP qiymətlərini yazın və ya işarəni götürün." };
  }

  if (onSale && (salePrice === null || Number.isNaN(salePrice))) {
    return { ok: false, message: "Endirimli qiyməti yazın və ya işarəni götürün." };
  }

  if (salePrice !== null && salePrice >= normalPrice) {
    return { ok: false, message: "Endirimli qiymət normal qiymətdən aşağı olmalıdır." };
  }

  return { ok: true, value: { stock, normalPrice, dealerPrice, vipPrice, salePrice } };
}

export type CreateProductDraftResult =
  | { ok: true; productId: string; contentSaved: boolean }
  | { ok: false; message: string };

// Step 1 of the visual create screen: the product is always created
// INACTIVE. The browser then uploads images and videos and only activates
// the product when everything succeeded and the user chose "Aktiv".
export async function createProductDraft(
  formData: FormData
): Promise<CreateProductDraftResult> {
  const sku = readText(formData, "sku");
  const name = readText(formData, "name");
  const description = readText(formData, "description") ?? "";
  const categoryId = readText(formData, "categoryId");
  const numbers = parseStockAndPrices(formData);

  if (!sku || !name || !categoryId) {
    return { ok: false, message: "Ad, SKU və kateqoriya mütləqdir." };
  }

  if (!uuidPattern.test(categoryId)) {
    return { ok: false, message: "Kateqoriya seçin." };
  }

  if (!numbers.ok) {
    return numbers;
  }

  const supabase = await getAuthedClient();

  const { data: productId, error } = await supabase.rpc("create_admin_product", {
    p_sku: sku,
    p_category_id: categoryId,
    p_stock: numbers.value.stock,
    p_normal_price: numbers.value.normalPrice,
    p_dealer_price: numbers.value.dealerPrice,
    p_vip_price: numbers.value.vipPrice,
    p_sale_price: numbers.value.salePrice,
    p_active: false,
  });

  if (error || !productId) {
    return { ok: false, message: dbErrorMessage(error, "Məhsul yaradılmadı.") };
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

  return { ok: true, productId, contentSaved: !contentError };
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

  if (!numbers.ok) {
    return fail(numbers.message);
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_product_pricing", {
    p_product_id: productId,
    p_stock: numbers.value.stock,
    p_normal_price: numbers.value.normalPrice,
    p_dealer_price: numbers.value.dealerPrice,
    p_vip_price: numbers.value.vipPrice,
    p_sale_price: numbers.value.salePrice,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Stok və qiymətlər yenilənmədi."));
  }

  revalidateProductPaths(productId);

  return ok("Stok və qiymətlər yadda saxlandı.");
}

// Stock only: WAREHOUSE (and OWNER / PRODUCT_MANAGER). Prices untouched.
export async function updateProductStock(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = readText(formData, "productId");
  const stock = Number(readText(formData, "stock"));

  if (!productId) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
    return fail("Stok 0 və ya daha böyük tam ədəd olmalıdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_product_stock", {
    p_product_id: productId,
    p_stock: stock,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Stok yenilənmədi."));
  }

  revalidateProductPaths(productId);

  return ok("Stok yadda saxlandı.");
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
const maxThumbnailSize = 512 * 1024;

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

  if (!uuidPattern.test(productId)) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

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

  // Optional small copy for catalog cards; the original is used otherwise.
  const thumbnail = formData.get("thumbnail");

  if (
    thumbnail instanceof File &&
    thumbnail.size > 0 &&
    thumbnail.size <= maxThumbnailSize &&
    thumbnail.type === "image/webp"
  ) {
    await supabase.storage
      .from("product-media")
      .upload(thumbnailPathFor(storagePath) as string, thumbnail, {
        contentType: "image/webp",
        upsert: false,
      });
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
    .remove([storagePath, thumbnailPathFor(storagePath)].filter(
      (path): path is string => Boolean(path)
    ));

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
