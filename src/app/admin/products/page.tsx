import type { Metadata } from "next";
import Link from "next/link";

import Pagination from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { formatAzn, readPage, uuidPattern } from "@/lib/format";

const PAGE_SIZE = 50;

export const metadata: Metadata = {
  title: "Məhsullar",
};

export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const categoryFilter =
    typeof params.category === "string" && uuidPattern.test(params.category)
      ? params.category
      : "";
  const statusFilter =
    params.status === "active" || params.status === "inactive"
      ? params.status
      : "";
  const lowStockOnly = params.stock === "low";
  const page = readPage(params.page);

  const { supabase, role } = await requireStaff("productsView");
  const canEdit = can(role, "productsEdit");

  // One page per request; filtering, search and counting run in the database.
  const [{ data: products, error }, { data: categories }] = await Promise.all([
    supabase.rpc("get_admin_products_page", {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_search: query || null,
      p_category_id: categoryFilter || null,
      p_status: statusFilter || null,
      p_low_stock: lowStockOnly,
      p_sort: lowStockOnly ? "stock" : "newest",
    }),
    supabase.rpc("get_admin_categories"),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title="Məhsullar" />
        <Alert>Məhsullar yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const visibleProducts = products ?? [];
  const total = visibleProducts[0]?.total_count ?? 0;

  const hasFilters = Boolean(
    query || categoryFilter || statusFilter || lowStockOnly
  );

  return (
    <>
      <PageHeader
        title="Məhsullar"
        description={hasFilters ? `${total} uyğun məhsul` : `${total} məhsul`}
        actions={
          canEdit ? (
            <Link href="/admin/products/new" className="btn btn-primary">
              + Yeni məhsul
            </Link>
          ) : undefined
        }
      />

      <form
        action="/admin/products"
        className="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_200px_160px_auto]"
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
            maxLength={100}
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
                {category.path}
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
            hasFilters || !canEdit ? undefined : (
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
                {canEdit && (
                  <>
                    <th className="text-right">Normal</th>
                    <th className="text-right">Diler</th>
                    <th className="text-right">VIP</th>
                  </>
                )}
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
                  {canEdit && (
                    <>
                      <td className="text-right whitespace-nowrap">
                        {formatAzn(product.normal_price)}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {formatAzn(product.dealer_price)}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {formatAzn(product.vip_price)}
                      </td>
                    </>
                  )}
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
                      {canEdit ? "Redaktə" : "Stok"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/products"
        params={{
          q: query,
          category: categoryFilter,
          status: statusFilter,
          stock: lowStockOnly ? "low" : undefined,
        }}
      />
    </>
  );
}
