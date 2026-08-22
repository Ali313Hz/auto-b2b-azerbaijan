"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const allowedPriceGroups = ["NORMAL", "DEALER", "VIP"] as const;

export async function updateCustomerPriceGroup(formData: FormData) {
  const customerId = formData.get("customerId");
  const priceGroup = formData.get("priceGroup");

  if (
    typeof customerId !== "string" ||
    typeof priceGroup !== "string" ||
    !allowedPriceGroups.includes(
      priceGroup as (typeof allowedPriceGroups)[number]
    )
  ) {
    throw new Error("Geçersiz müşteri veya fiyat grubu.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("set_customer_price_group", {
    target_customer_id: customerId,
    new_price_group: priceGroup as "NORMAL" | "DEALER" | "VIP",
  });

  if (error) {
    throw new Error("Fiyat grubu güncellenemedi.");
  }

  revalidatePath("/admin/customers");
  revalidatePath("/account");
  revalidatePath("/products");
}
export async function updateCustomerActive(formData: FormData) {
  const customerId = formData.get("customerId");
  const activeValue = formData.get("active");

  if (
    typeof customerId !== "string" ||
    typeof activeValue !== "string" ||
    (activeValue !== "true" && activeValue !== "false")
  ) {
    throw new Error("Geçersiz müşteri bilgisi.");
  }

  const active = activeValue === "true";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("set_customer_active", {
    target_customer_id: customerId,
    new_active: active,
  });

  if (error) {
    throw new Error("Müşteri durumu güncellenemedi.");
  }

  revalidatePath("/admin/customers");
  revalidatePath("/account");
  revalidatePath("/products");
  revalidatePath("/cart");
  revalidatePath("/orders");
}