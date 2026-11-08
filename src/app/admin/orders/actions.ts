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

const allowedStatuses = ["CONFIRMED", "CANCELLED"] as const;

type AllowedStatus = (typeof allowedStatuses)[number];

// Every order RPC checks the staff role in the database; the app only
// needs a signed-in user here.
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

function readId(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function revalidateOrder(orderId: string) {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

export async function updateOrderStatus(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = readId(formData, "orderId");
  const statusValue = formData.get("status");

  if (!orderId || !allowedStatuses.includes(statusValue as AllowedStatus)) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const status = statusValue as AllowedStatus;
  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_order_status", {
    p_order_id: orderId,
    p_status: status,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Sifarişin statusu dəyişdirilmədi."));
  }

  revalidateOrder(orderId);
  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(
    status === "CONFIRMED"
      ? "Sifariş təsdiqləndi."
      : "Sifariş ləğv edildi, stok geri qaytarıldı."
  );
}

// Opens a draft change (or returns the open draft).
export async function createOrderRevision(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = readId(formData, "orderId");

  if (!orderId) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("create_admin_order_revision", {
    p_order_id: orderId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Dəyişiklik yaradılmadı."));
  }

  revalidateOrder(orderId);

  return ok("Dəyişiklik qaralaması açıldı.");
}

type DraftItem = {
  product_id: string;
  quantity: number;
  unit_price: number | null;
};

// Only ids, quantities and unit prices are sent; line totals and the order
// total are calculated in the database.
function parseItems(value: FormDataEntryValue | null): DraftItem[] | null {
  if (typeof value !== "string" || value.length > 50_000) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length > 200) {
    return null;
  }

  const items: DraftItem[] = [];

  for (const raw of parsed) {
    const item = raw as Record<string, unknown>;
    const quantity = Number(item?.quantity);
    const priceText = String(item?.unit_price ?? "").replace(",", ".").trim();
    const price = priceText === "" ? null : Number(priceText);

    if (
      typeof item?.product_id !== "string" ||
      !uuidPattern.test(item.product_id) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100_000 ||
      (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000))
    ) {
      return null;
    }

    items.push({ product_id: item.product_id, quantity, unit_price: price });
  }

  return items;
}

// "Dəyişiklikləri saxla" (intent=save) or "Müştəriyə göndər" (intent=send:
// save, then send).
export async function saveOrderRevision(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = readId(formData, "orderId");
  const revisionId = readId(formData, "revisionId");
  const intent = formData.get("intent");
  const noteValue = formData.get("note");
  const note = typeof noteValue === "string" ? noteValue.trim().slice(0, 2000) : "";
  const items = parseItems(formData.get("items"));

  if (!orderId || !revisionId || (intent !== "save" && intent !== "send")) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  if (!items) {
    return fail(
      "Miqdar 1 ilə 100 000 arasında tam ədəd, qiymət isə 0 və ya daha böyük olmalıdır."
    );
  }

  if (intent === "send" && items.length === 0) {
    return fail("Sifarişdə ən azı bir məhsul olmalıdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("save_admin_order_revision", {
    p_revision_id: revisionId,
    p_items: items,
    p_note: note || null,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Dəyişikliklər saxlanmadı."));
  }

  if (intent === "send") {
    const { error: sendError } = await supabase.rpc("send_admin_order_revision", {
      p_revision_id: revisionId,
    });

    revalidateOrder(orderId);

    if (sendError) {
      return fail(
        dbErrorMessage(sendError, "Dəyişikliklər saxlandı, lakin müştəriyə göndərilmədi.")
      );
    }

    return ok("Dəyişikliklər müştəriyə göndərildi.");
  }

  revalidateOrder(orderId);

  return ok("Dəyişikliklər saxlandı. Müştəri hələ görmür.");
}

export async function resendOrderRevision(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = readId(formData, "orderId");
  const revisionId = readId(formData, "revisionId");

  if (!orderId || !revisionId) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("resend_admin_order_revision", {
    p_revision_id: revisionId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Yenidən göndərilmədi."));
  }

  revalidateOrder(orderId);

  return ok("Dəyişiklik müştəriyə yenidən göstərildi.");
}

export async function discardOrderRevision(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const orderId = readId(formData, "orderId");
  const revisionId = readId(formData, "revisionId");

  if (!orderId || !revisionId) {
    return fail("Sifariş məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("discard_admin_order_revision", {
    p_revision_id: revisionId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Dəyişiklik geri çağırılmadı."));
  }

  revalidateOrder(orderId);

  return ok("Dəyişiklik geri çağırıldı. Sifariş əvvəlki kimi qalır.");
}

export type OrderProductOption = {
  id: string;
  sku: string;
  name: string;
  stock: number;
  active: boolean;
  catalog_price: number | null;
};

// Product search for the order editor (OWNER, SALES; checked in the DB).
export async function searchOrderProducts(
  orderId: string,
  query: string
): Promise<OrderProductOption[]> {
  if (!uuidPattern.test(orderId)) {
    return [];
  }

  const supabase = await getAuthedClient();

  const { data, error } = await supabase.rpc("search_admin_order_products", {
    p_order_id: orderId,
    p_search: query.slice(0, 100),
  });

  if (error || !data) {
    return [];
  }

  return data;
}
