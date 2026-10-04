import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { updateOrderStatus } from "./actions";

const statusLabels = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
  CANCELLED: "İptal edildi",
} as const;

export default async function AdminOrdersPage() {
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
    redirect("/");
  }

  const { data: orders, error } = await supabase.rpc(
    "get_admin_orders"
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-semibold">
          Siparişler
        </h1>

        <p className="mt-4 text-red-500">
          Siparişler yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  const ordersWithItems = await Promise.all(
    (orders ?? []).map(async (order) => {
      const { data: items, error: itemsError } =
        await supabase.rpc("get_admin_order_items", {
          p_order_id: order.order_id,
        });

      return {
        ...order,
        items: items ?? [],
        itemsError: Boolean(itemsError),
      };
    })
  );

  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold">
        Siparişler
      </h1>

      {ordersWithItems.length === 0 ? (
        <p className="mt-8">
          Henüz sipariş bulunmuyor.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {ordersWithItems.map((order) => (
            <div
              key={order.order_id}
              className="rounded-xl border border-zinc-800 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold">
                    Sipariş
                  </p>

                  <p className="mt-1 text-sm text-zinc-400">
                    {order.order_id}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-zinc-400">
                    Durum
                  </p>

                  <p className="mt-1 font-semibold">
                    {statusLabels[order.status]}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 p-4">
                  <p className="text-sm text-zinc-400">
                    Müşteri
                  </p>

                  <p className="mt-1 font-semibold">
                    {order.company_name ?? "-"}
                  </p>

                  <p className="mt-1">
                    {order.contact_name ?? "-"}
                  </p>

                  <p className="mt-1 text-sm text-zinc-400">
                    {order.email ?? "-"}
                  </p>

                  <p className="mt-2 text-sm">
                    Fiyat grubu: {order.price_group}
                  </p>
                </div>

                <div className="rounded-lg border border-zinc-800 p-4">
                  <p>
                    Ürün sayısı: {order.item_count}
                  </p>

                  <p className="mt-2 text-xl font-semibold">
                    Toplam: {order.total_amount} AZN
                  </p>

                  <p className="mt-2 text-sm text-zinc-400">
                    Tarih:{" "}
                    {new Date(
                      order.created_at
                    ).toLocaleString("tr-TR")}
                  </p>
                </div>
              </div>

              <div className="mt-6 border-t border-zinc-800 pt-5">
                <h2 className="font-semibold">
                  Sipariş Ürünleri
                </h2>

                {order.itemsError ? (
                  <p className="mt-3 text-red-500">
                    Sipariş ürünleri yüklenemedi.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg bg-zinc-950 p-4"
                      >
                        <p className="font-semibold">
                          {item.sku}
                        </p>

                        <p className="mt-1">
                          Adet: {item.quantity}
                        </p>

                        <p className="mt-1">
                          Birim fiyat:{" "}
                          {item.unit_price} AZN
                        </p>

                        <p className="mt-1 font-semibold">
                          Ara toplam:{" "}
                          {item.line_total} AZN
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {order.status === "PENDING" && (
                <div className="mt-6 flex flex-wrap gap-3 border-t border-zinc-800 pt-5">
                  <form action={updateOrderStatus}>
                    <input
                      type="hidden"
                      name="orderId"
                      value={order.order_id}
                    />

                    <input
                      type="hidden"
                      name="status"
                      value="CONFIRMED"
                    />

                    <button
                      type="submit"
                      className="rounded-lg bg-white px-4 py-2 font-semibold text-black"
                    >
                      Siparişi Onayla
                    </button>
                  </form>

                  <form action={updateOrderStatus}>
                    <input
                      type="hidden"
                      name="orderId"
                      value={order.order_id}
                    />

                    <input
                      type="hidden"
                      name="status"
                      value="CANCELLED"
                    />

                    <button
                      type="submit"
                      className="rounded-lg border border-red-800 px-4 py-2 font-semibold text-red-500"
                    >
                      Siparişi İptal Et
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}