"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function addToCart(formData: FormData) {
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

  const { error } = await supabase.rpc("add_to_cart", {
    p_product_id: productId,
    p_quantity: 1,
  });

  if (error) {
    throw new Error("Sepete ekleme başarısız.");
  }

  revalidatePath("/products");
}
