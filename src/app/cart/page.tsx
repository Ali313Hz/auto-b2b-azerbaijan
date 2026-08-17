import { redirect } from "next/navigation";
import { changeCartQuantity, removeFromCart } from "./actions";

import { createClient } from "@/lib/supabase/server";



export default async function CartPage() {

    
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: items, error } = await supabase.rpc("get_customer_cart");

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Sepet</h1>
        <p className="mt-4 text-red-600">
          Sepet yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  const total =
    items?.reduce((sum, item) => sum + Number(item.line_total), 0) ?? 0;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Sepet</h1>

      {!items || items.length === 0 ? (
        <p className="mt-6">Sepet boş.</p>
      ) : (
        <>
          <div className="mt-6 space-y-4">
            {items.map((item) => (
              <div
                key={item.product_id}
                className="rounded-xl border border-zinc-800 p-5"
              >
                <p className="font-semibold">{item.sku}</p>
                <p className="mt-2">Adet: {item.quantity}</p>
                <div className="mt-4 flex items-center gap-3">
  <form action={changeCartQuantity}>
    <input type="hidden" name="productId" value={item.product_id} />
    <input type="hidden" name="delta" value="-1" />

    <button
      type="submit"
      disabled={item.quantity <= 1}
      className="rounded-lg border border-zinc-700 px-3 py-1 disabled:opacity-40"
    >
      −
    </button>
  </form>

  <span>{item.quantity}</span>

  <form action={changeCartQuantity}>
    <input type="hidden" name="productId" value={item.product_id} />
    <input type="hidden" name="delta" value="1" />

    <button
      type="submit"
      className="rounded-lg border border-zinc-700 px-3 py-1"
    >
      +
    </button>
  </form>

  <form action={removeFromCart}>
    <input type="hidden" name="productId" value={item.product_id} />

    <button
      type="submit"
      className="rounded-lg border border-red-800 px-3 py-1 text-red-400"
    >
      Sil
    </button>
  </form>
</div>
                <p className="mt-2">Birim fiyat: {item.unit_price} AZN</p>
                <p className="mt-2 font-semibold">
                  Ara toplam: {item.line_total} AZN
                </p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-2xl font-semibold">
            Toplam: {total.toFixed(2)} AZN
          </p>
        </>
      )}
    </main>
  );

  
}