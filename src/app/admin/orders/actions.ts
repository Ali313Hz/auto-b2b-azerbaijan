"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const allowedStatuses = ["CONFIRMED", "CANCELLED"] as const;

export async function updateOrderStatus(formData: FormData) {
  const orderId = formData.get("orderId");
  const statusValue = formData.get("status");

  if (
    typeof orderId !== "string" ||
    !orderId ||
    typeof statusValue !== "string" ||
    !allowedStatuses.includes(
      statusValue as (typeof allowedStatuses)[number]
    )
  ) {
    throw new Error("Geçersiz sipariş bilgisi.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.active || staff.role !== "OWNER") {
    throw new Error("Bu işlem için yetkiniz yok.");
  }

  const { error } = await supabase.rpc(
    "update_admin_order_status",
    {
      p_order_id: orderId,
      p_status: statusValue as "CONFIRMED" | "CANCELLED",
    }
  );

  if (error) {
    throw new Error("Sipariş durumu güncellenemedi.");
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/products");
  revalidatePath("/products");
}