import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "./actions";

export default async function AdminProductsPage() {
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

  const { data: products, error } = await supabase.rpc(
    "get_admin_products"
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Ürünler</h1>
        <p className="mt-4 text-red-500">
          Ürünler yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Ürünler</h1>

      {!products || products.length === 0 ? (
        <p className="mt-6">Ürün bulunamadı.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="rounded-xl border border-zinc-800 p-5"
            >
              <p className="text-lg font-semibold">{product.sku}</p>

              <p className="mt-2">
                Kategori: {product.category_name ?? "-"}
              </p>

              <p className="mt-2">
                Durum: {product.active ? "Aktif" : "Deaktif"}
              </p>

              <form action={updateProduct} className="mt-5 space-y-4">
                <input
                  type="hidden"
                  name="productId"
                  value={product.id}
                />

                <div>
                  <label className="block text-sm">Stok</label>
                  <input
                    type="number"
                    name="stock"
                    min="0"
                    step="1"
                    required
                    defaultValue={product.stock}
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm">NORMAL fiyat</label>
                  <input
                    type="number"
                    name="normalPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={product.normal_price ?? ""}
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm">DEALER fiyat</label>
                  <input
                    type="number"
                    name="dealerPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={product.dealer_price ?? ""}
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm">VIP fiyat</label>
                  <input
                    type="number"
                    name="vipPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={product.vip_price ?? ""}
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <button
                  type="submit"
                  className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
                >
                  Kaydet
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}