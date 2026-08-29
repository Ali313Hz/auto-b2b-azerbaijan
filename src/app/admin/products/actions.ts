"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function updateProduct(formData: FormData) {
  const productId = formData.get("productId");
  const stockValue = formData.get("stock");
  const normalPriceValue = formData.get("normalPrice");
  const dealerPriceValue = formData.get("dealerPrice");
  const vipPriceValue = formData.get("vipPrice");

  if (
    typeof productId !== "string" ||
    typeof stockValue !== "string" ||
    typeof normalPriceValue !== "string" ||
    typeof dealerPriceValue !== "string" ||
    typeof vipPriceValue !== "string"
  ) {
    throw new Error("Geçersiz ürün bilgisi.");
  }

  const stock = Number(stockValue);
  const normalPrice = Number(normalPriceValue);
  const dealerPrice = Number(dealerPriceValue);
  const vipPrice = Number(vipPriceValue);

  if (
    !Number.isInteger(stock) ||
    stock < 0 ||
    !Number.isFinite(normalPrice) ||
    normalPrice < 0 ||
    !Number.isFinite(dealerPrice) ||
    dealerPrice < 0 ||
    !Number.isFinite(vipPrice) ||
    vipPrice < 0
  ) {
    throw new Error("Stok veya fiyat değerleri geçersiz.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("update_admin_product", {
    p_product_id: productId,
    p_stock: stock,
    p_normal_price: normalPrice,
    p_dealer_price: dealerPrice,
    p_vip_price: vipPrice,
  });

  if (error) {
    throw new Error("Ürün güncellenemedi.");
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/cart");
}
export async function updateProductActive(formData: FormData) {
  const productId = formData.get("productId");
  const activeValue = formData.get("active");

  if (
    typeof productId !== "string" ||
    typeof activeValue !== "string"
  ) {
    throw new Error("Geçersiz ürün bilgisi.");
  }

  const active = activeValue === "true";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "update_admin_product_active",
    {
      p_product_id: productId,
      p_active: active,
    }
  );

  if (error) {
    throw new Error("Ürün durumu güncellenemedi.");
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/cart");
}
export async function createProduct(formData: FormData) {
  const skuValue = formData.get("sku");
  const categoryId = formData.get("categoryId");
  const stockValue = formData.get("stock");
  const normalPriceValue = formData.get("normalPrice");
  const dealerPriceValue = formData.get("dealerPrice");
  const vipPriceValue = formData.get("vipPrice");
  const activeValue = formData.get("active");

  if (
    typeof skuValue !== "string" ||
    typeof categoryId !== "string" ||
    typeof stockValue !== "string" ||
    typeof normalPriceValue !== "string" ||
    typeof dealerPriceValue !== "string" ||
    typeof vipPriceValue !== "string" ||
    typeof activeValue !== "string"
  ) {
    throw new Error("Geçersiz ürün bilgisi.");
  }

  const sku = skuValue.trim();
  const stock = Number(stockValue);
  const normalPrice = Number(normalPriceValue);
  const dealerPrice = Number(dealerPriceValue);
  const vipPrice = Number(vipPriceValue);
  const active = activeValue === "true";

  if (
    !sku ||
    !categoryId ||
    !Number.isInteger(stock) ||
    stock < 0 ||
    !Number.isFinite(normalPrice) ||
    normalPrice < 0 ||
    !Number.isFinite(dealerPrice) ||
    dealerPrice < 0 ||
    !Number.isFinite(vipPrice) ||
    vipPrice < 0
  ) {
    throw new Error("Ürün bilgileri geçersiz.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("create_admin_product", {
    p_sku: sku,
    p_category_id: categoryId,
    p_stock: stock,
    p_normal_price: normalPrice,
    p_dealer_price: dealerPrice,
    p_vip_price: vipPrice,
    p_active: active,
  });

  if (error) {
    throw new Error("Ürün oluşturulamadı.");
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function updateProductContent(formData: FormData) {
  const productId = formData.get("productId");
  const nameValue = formData.get("name");
  const descriptionValue = formData.get("description");
  const categoryIdValue = formData.get("categoryId");

  if (
  typeof productId !== "string" ||
  typeof nameValue !== "string" ||
  typeof descriptionValue !== "string" ||
  typeof categoryIdValue !== "string" ||
  !categoryIdValue
) {
  throw new Error("Geçersiz ürün bilgisi.");
}

  const name = nameValue.trim();
  const description = descriptionValue.trim();

  if (!name) {
    throw new Error("Ürün adı gereklidir.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "update_admin_product_content",
    {
      p_product_id: productId,
      p_name: name,
      p_description: description,
      p_category_id: categoryIdValue,
    }
  );

  if (error) {
    throw new Error("Ürün bilgileri güncellenemedi.");
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function uploadProductImage(formData: FormData) {
  const productId = formData.get("productId");
  const imageValue = formData.get("image");

  if (
    typeof productId !== "string" ||
    !(imageValue instanceof File) ||
    imageValue.size === 0
  ) {
    throw new Error("Geçersiz fotoğraf bilgisi.");
  }

  const allowedImageTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedImageTypes.includes(imageValue.type)) {
    throw new Error(
      "Sadece JPG, PNG veya WEBP fotoğraf yüklenebilir."
    );
  }

  const maxImageSize = 5 * 1024 * 1024;

  if (imageValue.size > maxImageSize) {
    throw new Error("Fotoğraf en fazla 5 MB olabilir.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const extensionByMimeType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extension = extensionByMimeType[imageValue.type];

  const storagePath =
    `${productId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("product-media")
    .upload(storagePath, imageValue, {
      contentType: imageValue.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error("Fotoğraf Storage'a yüklenemedi.");
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
    await supabase.storage
      .from("product-media")
      .remove([storagePath]);

    throw new Error("Fotoğraf ürün kaydına bağlanamadı.");
  }

  revalidatePath("/admin/products");
}

export async function setProductPrimaryImage(
  formData: FormData
) {
  const mediaId = formData.get("mediaId");

  if (typeof mediaId !== "string" || !mediaId) {
    throw new Error("Geçersiz fotoğraf bilgisi.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "set_admin_product_primary_media",
    {
      p_media_id: mediaId,
    }
  );

  if (error) {
    throw new Error("Ana fotoğraf değiştirilemedi.");
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function deleteProductImage(
  formData: FormData
) {
  const mediaId = formData.get("mediaId");

  if (typeof mediaId !== "string" || !mediaId) {
    throw new Error("Geçersiz fotoğraf bilgisi.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { data: storagePath, error: deleteError } =
    await supabase.rpc(
      "delete_admin_product_media",
      {
        p_media_id: mediaId,
      }
    );

  if (deleteError || !storagePath) {
    throw new Error("Fotoğraf kaydı silinemedi.");
  }

  const { error: storageError } =
    await supabase.storage
      .from("product-media")
      .remove([storagePath]);

  if (storageError) {
    throw new Error(
      "Fotoğraf kaydı silindi ancak Storage temizlenemedi."
    );
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function registerProductVideo(formData: FormData) {
  const productId = formData.get("productId");
  const storagePath = formData.get("storagePath");
  const originalName = formData.get("originalName");
  const mimeType = formData.get("mimeType");

  if (
    typeof productId !== "string" ||
    !productId ||
    typeof storagePath !== "string" ||
    !storagePath ||
    typeof originalName !== "string" ||
    typeof mimeType !== "string"
  ) {
    throw new Error("Geçersiz video bilgisi.");
  }

  const allowedVideoTypes = [
    "video/mp4",
    "video/webm",
  ];

  if (!allowedVideoTypes.includes(mimeType)) {
    throw new Error(
      "Sadece MP4 veya WEBM video yüklenebilir."
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

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
    await supabase.storage
      .from("product-media")
      .remove([storagePath]);

    throw new Error(
      "Video ürün kaydına bağlanamadı."
    );
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
}