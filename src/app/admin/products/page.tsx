import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { formatAzn } from "@/lib/format";

export const metadata: Metadata = {
  title: "Məhsullar",
};

export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const normalizedQuery = query.toLocaleLowerCase("az");
  const categoryFilter =
    typeof params.category === "string" ? params.category : "";
  const statusFilter =
    typeof params.status === "string" ? params.status : "";
  const lowStockOnly = params.stock === "low";

  const { supabase } = await requireOwner();

  const [{ data: products, error }, { data: categories }] = await Promise.all(
    [supabase.rpc("get_admin_products"), supabase.rpc("get_admin_categories")]
  );

  if (error) {
    return (
      <>
        <PageHeader title="Məhsullar" />
        <Alert>Məhsullar yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const allProducts = products ?? [];

  const visibleProducts = allProducts.filter((product) => {
    if (categoryFilter && product.category_id !== categoryFilter) {
      return false;
    }

    if (statusFilter === "active" && !product.active) return false;
    if (statusFilter === "inactive" && product.active) return false;
    if (lowStockOnly && product.stock > 5) return false;

    if (!normalizedQuery) {
      return true;
    }

    return [product.name, product.sku].some((value) =>
      value.toLocaleLowerCase("az").includes(normalizedQuery)
    );
  });

  const hasFilters = Boolean(
    query || categoryFilter || statusFilter || lowStockOnly
  );

  return (
    <>
      <PageHeader
        title="Məhsullar"
        description={`${allProducts.length} məhsul`}
        actions={
          <Link href="/admin/products/new" className="btn btn-primary">
            + Yeni məhsul
          </Link>
        }
      />

      <form
        action="/admin/products"
        className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_200px_160px_auto]"
      >
        <div>
          <label htmlFor="product-search" className="label">
            Axtar
          </label>
          <input
            id="product-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Ad və ya SKU"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="product-category" className="label">
            Kateqoriya
          </label>
          <select
            id="product-category"
            name="category"
            defaultValue={categoryFilter}
            className="input"
          >
            <option value="">Hamısı</option>
            {(categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="product-status" className="label">
            Status
          </label>
          <select
            id="product-status"
            name="status"
            defaultValue={statusFilter}
            className="input"
          >
            <option value="">Hamısı</option>
            <option value="active">Aktiv</option>
            <option value="inactive">Deaktiv</option>
          </select>
        </div>

        <div className="flex items-end gap-2">
          {lowStockOnly && <input type="hidden" name="stock" value="low" />}
          <button type="submit" className="btn btn-secondary">
            Filtrlə
          </button>
          {hasFilters && (
            <Link href="/admin/products" className="btn btn-secondary">
              Sıfırla
            </Link>
          )}
        </div>
      </form>

      {lowStockOnly && (
        <Alert tone="amber">Yalnız stoku 5 və daha az olan məhsullar.</Alert>
      )}

      {visibleProducts.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Uyğun məhsul tapılmadı" : "Hələ məhsul yoxdur"}
          action={
            hasFilters ? undefined : (
              <Link href="/admin/products/new" className="btn btn-primary">
                İlk məhsulu yarat
              </Link>
            )
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Məhsul</th>
                <th>Kateqoriya</th>
                <th className="text-right">Stok</th>
                <th className="text-right">Normal</th>
                <th className="text-right">Diler</th>
                <th className="text-right">VIP</th>
                <th>Status</th>
                <th className="sr-only">Əməliyyat</th>
              </tr>
            </thead>

            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id} className="hover:bg-zinc-900/60">
                  <td className="max-w-xs">
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="block truncate font-medium text-white hover:text-amber-400"
                    >
                      {product.name}
                    </Link>
                    <span className="font-mono text-xs text-zinc-500">
                      {product.sku}
                    </span>
                  </td>
                  <td className="text-zinc-400">
                    {product.category_name ?? "—"}
                  </td>
                  <td className="text-right">
                    <span
                      className={
                        product.stock === 0
                          ? "font-semibold text-red-400"
                          : product.stock <= 5
                            ? "font-semibold text-amber-400"
                            : "text-zinc-200"
                      }
                    >
                      {product.stock}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {formatAzn(product.normal_price)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {formatAzn(product.dealer_price)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {formatAzn(product.vip_price)}
                  </td>
                  <td>
                    {product.active ? (
                      <Badge tone="green">Aktiv</Badge>
                    ) : (
                      <Badge tone="red">Deaktiv</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Redaktə
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
