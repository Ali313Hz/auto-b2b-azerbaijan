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
import { createClient } from "@/lib/supabase/server";

// The customer accepts or rejects a change sent by the seller. Only the
// revision id and the answer are sent; prices, quantities and totals come
// from the database, which also checks that the order is the customer's.
export async function respondToOrderRevision(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = formData.get("orderId");
  const revisionId = formData.get("revisionId");
  const answer = formData.get("answer");

  if (
    typeof orderId !== "string" ||
    typeof revisionId !== "string" ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(revisionId) ||
    (answer !== "accept" && answer !== "reject")
  ) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("respond_to_order_revision", {
    p_revision_id: revisionId,
    p_accept: answer === "accept",
  });

  if (error) {
    return fail(
      dbErrorMessage(
        error,
        answer === "accept" ? "Dəyişikliklər qəbul edilmədi." : "Cavabınız göndərilmədi."
      )
    );
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/products");

  return ok(
    answer === "accept"
      ? "Dəyişikliklər qəbul edildi. Sifarişiniz təsdiqləndi."
      : "Cavabınız satıcıya göndərildi. Sifarişiniz silinmədi."
  );
}
