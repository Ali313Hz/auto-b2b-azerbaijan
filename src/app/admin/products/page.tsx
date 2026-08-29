import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  createProduct,
  updateProduct,
  updateProductActive,
  updateProductContent,
} from "./actions";

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

  const { data: products, error: productsError } =
    await supabase.rpc("get_admin_products");

  const { data: categories, error: categoriesError } =
    await supabase.rpc("get_admin_categories");

  if (productsError || categoriesError) {
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

      <form
        action={createProduct}
        className="mt-6 space-y-4 rounded-xl border border-zinc-800 p-5"
      >
        <h2 className="text-xl font-semibold">
          Yeni Ürün Ekle
        </h2>

        <div>
          <label className="block text-sm">SKU</label>

          <input
            name="sku"
            required
            placeholder="Örnek: LED-H4-001"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">Kategori</label>

          <select
            name="categoryId"
            required
            defaultValue=""
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          >
            <option value="" disabled>
              Kategori seç
            </option>

            {categories?.map((category) => (
              <option
                key={category.id}
                value={category.id}
              >
                {category.name}
                {category.active ? "" : " (Deaktif)"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm">Stok</label>

          <input
            type="number"
            name="stock"
            min="0"
            step="1"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            NORMAL fiyat
          </label>

          <input
            type="number"
            name="normalPrice"
            min="0"
            step="0.01"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            DEALER fiyat
          </label>

          <input
            type="number"
            name="dealerPrice"
            min="0"
            step="0.01"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            VIP fiyat
          </label>

          <input
            type="number"
            name="vipPrice"
            min="0"
            step="0.01"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Durum
          </label>

          <select
            name="active"
            defaultValue="true"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          >
            <option value="true">Aktif</option>
            <option value="false">Deaktif</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
        >
          Ürün Oluştur
        </button>
      </form>

      {!products || products.length === 0 ? (
        <p className="mt-6">Ürün bulunamadı.</p>
      ) : (
        <div className="mt-8 space-y-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="rounded-xl border border-zinc-800 p-5"
            >
              <p className="text-lg font-semibold">
  {product.name}
</p>

<p className="mt-1 text-sm text-zinc-400">
  SKU: {product.sku}
</p>

              <p className="mt-2">
                Kategori:{" "}
                {product.category_name ?? "-"}
              </p>

              <p className="mt-2">
                Durum:{" "}
                {product.active ? "Aktif" : "Deaktif"}
              </p>

              <form
  action={updateProductContent}
  className="mt-5 space-y-4 rounded-lg border border-zinc-800 p-4"
>
  <input
    type="hidden"
    name="productId"
    value={product.id}
  />

  <div>
    <label className="block text-sm">
      Ürün adı
    </label>

    <input
      name="name"
      required
      defaultValue={product.name}
      className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2"
    />
  </div>

  <div>
    <label className="block text-sm">
      Açıklama
    </label>

    <textarea
      name="description"
      rows={4}
      defaultValue={product.description ?? ""}
      className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2"
    />
  </div>

  <div>
    <label className="block text-sm">
      Kategori
    </label>

    <select
      name="categoryId"
      required
      defaultValue={product.category_id ?? ""}
      className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
    >
      <option value="" disabled>
        Kategori seç
      </option>

      {categories?.map((category) => (
        <option
          key={category.id}
          value={category.id}
        >
          {category.name}
          {category.active ? "" : " (Deaktif)"}
        </option>
      ))}
    </select>
  </div>

  <button
    type="submit"
    className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
  >
    Ürün Bilgilerini Kaydet
  </button>
</form>

              <form
                action={updateProductActive}
                className="mt-3"
              >
                <input
                  type="hidden"
                  name="productId"
                  value={product.id}
                />

                <input
                  type="hidden"
                  name="active"
                  value={
                    product.active
                      ? "false"
                      : "true"
                  }
                />

                <button
                  type="submit"
                  className="rounded-lg border border-zinc-700 px-4 py-2"
                >
                  {product.active
                    ? "Deaktif et"
                    : "Aktif et"}
                </button>
              </form>

              <form
                action={updateProduct}
                className="mt-5 space-y-4"
              >
                <input
                  type="hidden"
                  name="productId"
                  value={product.id}
                />

                <div>
                  <label className="block text-sm">
                    Stok
                  </label>

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
                  <label className="block text-sm">
                    NORMAL fiyat
                  </label>

                  <input
                    type="number"
                    name="normalPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      product.normal_price ?? ""
                    }
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm">
                    DEALER fiyat
                  </label>

                  <input
                    type="number"
                    name="dealerPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      product.dealer_price ?? ""
                    }
                    className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm">
                    VIP fiyat
                  </label>

                  <input
                    type="number"
                    name="vipPrice"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      product.vip_price ?? ""
                    }
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