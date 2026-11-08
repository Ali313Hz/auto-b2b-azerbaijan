import type { Metadata } from "next";
import Link from "next/link";

import Pagination from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { categoryOptionLabel, formatAzn, readPage, uuidPattern } from "@/lib/format";

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
                {categoryOptionLabel(category)}
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
        <>
          {/* Mobile: one card per product. */}
          <ul className="space-y-3 md:hidden">
            {visibleProducts.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/admin/products/${product.id}`}
                  className="card block space-y-2 p-4 hover:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-white">{product.name}</p>
                      <p className="font-mono text-xs text-zinc-500">{product.sku}</p>
                    </div>
                    {product.active ? (
                      <Badge tone="green">Aktiv</Badge>
                    ) : (
                      <Badge tone="red">Deaktiv</Badge>
                    )}
                  </div>
                  <p className="text-sm text-zinc-400">{product.category_name ?? "—"}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      <span className="text-zinc-500">Stok: </span>
                      <StockValue stock={product.stock} />
                    </span>
                    {canEdit && (
                      <>
                        <span className="text-zinc-300">
                          <span className="text-zinc-500">N: </span>
                          {formatAzn(product.normal_price)}
                        </span>
                        <span className="text-zinc-300">
                          <span className="text-zinc-500">D: </span>
                          {formatAzn(product.dealer_price)}
                        </span>
                        <span className="text-zinc-300">
                          <span className="text-zinc-500">VIP: </span>
                          {formatAzn(product.vip_price)}
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: compact table that fits without sideways scrolling. */}
          <div className="table-wrap hidden md:block">
            <table className="table min-w-0 table-fixed">
              <thead>
                <tr>
                  <th className={canEdit ? "w-[34%]" : "w-[45%]"}>Məhsul</th>
                  <th>Kateqoriya</th>
                  <th className="w-20 text-right">Stok</th>
                  {canEdit && <th className="w-36 text-right">Qiymətlər</th>}
                  <th className="w-24">Status</th>
                </tr>
              </thead>

              <tbody>
                {visibleProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-zinc-900/60">
                    <td>
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="block truncate font-medium text-white hover:text-amber-400"
                        title={product.name}
                      >
                        {product.name}
                      </Link>
                      <span className="block truncate font-mono text-xs text-zinc-500">
                        {product.sku}
                      </span>
                    </td>
                    <td className="truncate text-zinc-400" title={product.category_name ?? undefined}>
                      {product.category_name ?? "—"}
                    </td>
                    <td className="text-right">
                      <StockValue stock={product.stock} />
                    </td>
                    {canEdit && (
                      <td className="text-right text-xs leading-5 whitespace-nowrap">
                        <span className="block text-zinc-200">
                          <span className="text-zinc-500">N </span>
                          {formatAzn(product.normal_price)}
                        </span>
                        <span className="block text-zinc-300">
                          <span className="text-zinc-500">D </span>
                          {formatAzn(product.dealer_price)}
                        </span>
                        <span className="block text-amber-300">
                          <span className="text-zinc-500">VIP </span>
                          {formatAzn(product.vip_price)}
                        </span>
                      </td>
                    )}
                    <td>
                      {product.active ? (
                        <Badge tone="green">Aktiv</Badge>
                      ) : (
                        <Badge tone="red">Deaktiv</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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

function StockValue({ stock }: { stock: number }) {
  return (
    <span
      className={
        stock === 0
          ? "font-semibold text-red-400"
          : stock <= 5
            ? "font-semibold text-amber-400"
            : "text-zinc-200"
      }
    >
      {stock}
    </span>
  );
}
