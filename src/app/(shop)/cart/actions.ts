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

export async function changeCartQuantity(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = formData.get("productId");
  const delta = Number(formData.get("delta"));

  if (
    typeof productId !== "string" ||
    !productId ||
    (delta !== 1 && delta !== -1)
  ) {
    return fail("Yanlış sorğu.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("change_cart_quantity", {
    p_product_id: productId,
    p_delta: delta,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Miqdar dəyişdirilmədi."));
  }

  revalidatePath("/", "layout");

  return ok("Miqdar yeniləndi.");
}

export async function removeFromCart(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const productId = formData.get("productId");

  if (typeof productId !== "string" || !productId) {
    return fail("Yanlış sorğu.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("remove_from_cart", {
    p_product_id: productId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Məhsul səbətdən silinmədi."));
  }

  revalidatePath("/", "layout");

  return ok("Məhsul səbətdən silindi.");
}

export async function createOrder(
  _state: ActionResult,
  _formData: FormData
): Promise<ActionResult> {
  void _formData;

  const supabase = await getAuthedClient();

  const { data: orderId, error } = await supabase.rpc(
    "create_order_from_cart"
  );

  if (error || !orderId) {
    return fail(dbErrorMessage(error, "Sifariş yaradılmadı."));
  }

  revalidatePath("/", "layout");

  redirect(`/orders/${orderId}?created=1`);
}
