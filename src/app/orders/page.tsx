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

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Siparişlerim</h1>

      {!orders || orders.length === 0 ? (
        <p className="mt-6">Henüz siparişiniz yok.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((order) => (
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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}