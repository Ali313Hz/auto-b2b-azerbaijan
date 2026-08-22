import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { addToCart } from "./actions";

export default async function ProductsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: products, error } = await supabase.rpc(
  "get_customer_catalog"
);

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Məhsullar</h1>
        <p className="mt-4 text-red-600">
          Məhsullar yüklənərkən xəta baş verdi.
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Məhsullar</h1>

      {!products || products.length === 0 ? (
        <p className="mt-6">Aktiv məhsul tapılmadı.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="rounded-xl border border-zinc-800 p-5"
            >
              <p className="font-semibold">{product.sku}</p>
              <p className="mt-2 text-sm text-zinc-400">
  Kategori: {product.category_name ?? "Kategorisiz"}
</p>
              <p className="mt-2">Stok: {product.stock}</p>
              <p className="mt-2 text-xl font-semibold">
  {product.price} AZN
</p>

<form action={addToCart} className="mt-4">
  <input type="hidden" name="productId" value={product.id} />

  <button
    type="submit"
    className="rounded-lg bg-white px-4 py-2 font-medium text-black"
  >
    Sepete ekle
  </button>
</form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}