"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function changeCartQuantity(formData: FormData) {
  const productId = formData.get("productId");
  const delta = Number(formData.get("delta"));

  if (
    typeof productId !== "string" ||
    !Number.isInteger(delta) ||
    (delta !== 1 && delta !== -1)
  ) {
    return;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("change_cart_quantity", {
    p_product_id: productId,
    p_delta: delta,
  });

  if (error) {
    throw new Error("Sepet miktarı güncellenemedi.");
  }

  revalidatePath("/cart");
}

export async function removeFromCart(formData: FormData) {
  const productId = formData.get("productId");

  if (typeof productId !== "string") {
    return;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("remove_from_cart", {
    p_product_id: productId,
  });

  if (error) {
    throw new Error("Ürün sepetten silinemedi.");
  }

  revalidatePath("/cart");
}
export async function createOrder() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("create_order_from_cart");

  if (error) {
    throw new Error("Sipariş oluşturulamadı.");
  }

  revalidatePath("/cart");
}