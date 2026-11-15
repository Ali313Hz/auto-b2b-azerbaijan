"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { uuidPattern } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// "Ödənişi etdim": only tells the seller; the database accepts it only for
// the customer's own order and never marks anything as paid.
export async function reportPayment(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = formData.get("orderId");

  if (typeof orderId !== "string" || !uuidPattern.test(orderId)) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("report_order_payment", { p_order_id: orderId });

  if (error) {
    return fail(dbErrorMessage(error, "Ödəniş məlumatı göndərilmədi. Yenidən cəhd edin."));
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");

  return ok("Ödəniş məlumatı satıcıya göndərildi.");
}
