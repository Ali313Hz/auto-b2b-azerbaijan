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

const allowedStatuses = ["CONFIRMED", "CANCELLED"] as const;

type AllowedStatus = (typeof allowedStatuses)[number];

export async function updateOrderStatus(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = formData.get("orderId");
  const statusValue = formData.get("status");

  if (
    typeof orderId !== "string" ||
    !orderId ||
    !allowedStatuses.includes(statusValue as AllowedStatus)
  ) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const status = statusValue as AllowedStatus;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.active || staff.role !== "OWNER") {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { error } = await supabase.rpc("update_admin_order_status", {
    p_order_id: orderId,
    p_status: status,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Sifarişin statusu dəyişdirilmədi."));
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/orders");

  return ok(
    status === "CONFIRMED"
      ? "Sifariş təsdiqləndi."
      : "Sifariş ləğv edildi, stok geri qaytarıldı."
  );
}
