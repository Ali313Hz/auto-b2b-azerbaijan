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