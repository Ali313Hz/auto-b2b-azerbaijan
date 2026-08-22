import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function OrdersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: orders, error } = await supabase.rpc(
    "get_customer_orders"
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Siparişlerim</h1>
        <p className="mt-4 text-red-600">
          Siparişler yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Siparişlerim</h1>
        <p className="mt-6">Henüz siparişiniz yok.</p>
      </main>
    );
  }

  const ordersWithItems = await Promise.all(
    orders.map(async (order) => {
      const { data: items, error: itemsError } = await supabase.rpc(
        "get_customer_order_items",
        {
          p_order_id: order.order_id,
        }
      );

      return {
        ...order,
        items: items ?? [],
        itemsError: Boolean(itemsError),
      };
    })
  );

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Siparişlerim</h1>

      <div className="mt-6 space-y-6">
        {ordersWithItems.map((order) => (
          <div
            key={order.order_id}
            className="rounded-xl border border-zinc-800 p-5"
          >
            <p className="font-semibold">
              Sipariş: {order.order_id}
            </p>

            <p className="mt-2">
              Durum: {order.status}
            </p>

            <p className="mt-2">
              Toplam: {order.total_amount} AZN
            </p>

            <p className="mt-2 text-sm text-zinc-400">
              Tarih:{" "}
              {new Date(order.created_at).toLocaleString("tr-TR")}
            </p>

            <div className="mt-5 border-t border-zinc-800 pt-4">
              <p className="font-semibold">Ürünler</p>

              {order.itemsError ? (
                <p className="mt-3 text-red-600">
                  Sipariş ürünleri yüklenemedi.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {order.items.map((item) => (
                    <div
                      key={item.product_id}
                      className="rounded-lg bg-zinc-950 p-4"
                    >
                      <p className="font-semibold">{item.sku}</p>
                      <p className="mt-1">Adet: {item.quantity}</p>
                      <p className="mt-1">
                        Birim fiyat: {item.unit_price} AZN
                      </p>
                      <p className="mt-1 font-semibold">
                        Ara toplam: {item.line_total} AZN
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}