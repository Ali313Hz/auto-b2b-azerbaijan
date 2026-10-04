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

export async function addToCart(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = formData.get("productId");
  const quantity = Number(formData.get("quantity") ?? 1);

  if (typeof productId !== "string" || !productId) {
    return fail("Məhsul məlumatı yanlışdır.");
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    return fail("Miqdar 1 və ya daha çox tam ədəd olmalıdır.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("add_to_cart", {
    p_product_id: productId,
    p_quantity: quantity,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Məhsul səbətə əlavə edilmədi."));
  }

  revalidatePath("/", "layout");

  return ok("Səbətə əlavə edildi.");
}
