import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  shortId,
} from "@/lib/format";
import { can } from "@/lib/roles";

const LOW_STOCK_THRESHOLD = 5;

const empty = { data: null, error: null };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const [{ supabase, role }, query] = await Promise.all([
    requireStaff(),
    searchParams,
  ]);

  const showOrders = can(role, "ordersView");
  const showProducts = can(role, "productsView");
  const showCustomers = can(role, "customersView");

  // Counts come from one aggregate RPC; only the rows shown are fetched,
  // and only the sections this role may see.
  const [ordersResult, statsResult, lowStockResult] = await Promise.all([
    showOrders ? supabase.rpc("get_admin_orders") : empty,
    supabase.rpc("get_admin_dashboard_stats"),
    showProducts
      ? supabase.rpc("get_admin_products_page", {
          p_page: 1,
          p_page_size: 6,
          p_low_stock: true,
          p_sort: "stock",
        })
      : empty,
  ]);

  const orders = ordersResult.data ?? [];
  const counts = statsResult.data?.[0];
  const lowStock = lowStockResult.data ?? [];
  const hasError =
    ordersResult.error || statsResult.error || lowStockResult.error;

  const pendingOrders = orders.filter((order) => order.status === "PENDING");
  const lowStockCount = counts?.low_stock_products ?? 0;

  const stats = [
    showOrders && {
      label: "Gözləyən sifarişlər",
      value: pendingOrders.length,
      href: "/admin/orders?status=PENDING",
      highlight: pendingOrders.length > 0,
    },
    showProducts && {
      label: "Aktiv məhsullar",
      value: `${counts?.active_products ?? 0} / ${counts?.total_products ?? 0}`,
      href: "/admin/products",
    },
    showProducts && {
      label: "Az stoklu məhsullar",
      value: lowStockCount,
      href: "/admin/products?stock=low",
      highlight: lowStockCount > 0,
    },
    showCustomers && {
      label: "Aktiv müştərilər",
      value: counts?.active_customers ?? 0,
      href: "/admin/customers",
    },
  ].filter((stat) => !!stat);

  return (
    <>
      <PageHeader
        title="İdarə paneli"
        description="Sifarişlər, məhsullar və müştərilər üzrə qısa baxış."
      />

      {query.notice === "forbidden" && (
        <Alert tone="amber">Bu bölmə üçün rolunuzun icazəsi yoxdur.</Alert>
      )}

      {hasError && (
        <Alert>Bəzi məlumatlar yüklənmədi. Səhifəni yeniləyin.</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="card p-4 transition-colors hover:border-zinc-600"
          >
            <p className="text-xs text-zinc-400 sm:text-sm">{stat.label}</p>
            <p
              className={`mt-2 text-2xl font-bold sm:text-3xl ${
                stat.highlight ? "text-amber-400" : "text-white"
              }`}
            >
              {stat.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {showOrders && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">Gözləyən sifarişlər</h2>
            <Link
              href="/admin/orders"
              className="text-sm text-amber-400 hover:text-amber-300"
            >
              Hamısı →
            </Link>
          </div>

          {pendingOrders.length === 0 ? (
            <EmptyState title="Gözləyən sifariş yoxdur" />
          ) : (
            <ul className="card divide-y divide-zinc-800">
              {pendingOrders.slice(0, 6).map((order) => (
                <li key={order.order_id}>
                  <Link
                    href={`/admin/orders/${order.order_id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-900"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">
                        {order.company_name ?? order.email ?? "—"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        #{shortId(order.order_id)} ·{" "}
                        {formatDate(order.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge tone={orderStatusTones[order.status]}>
                        {orderStatusLabels[order.status]}
                      </Badge>
                      <span className="font-semibold text-white">
                        {formatAzn(order.total_amount)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}

        {showProducts && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-white">
              Az stoklu məhsullar (≤ {LOW_STOCK_THRESHOLD})
            </h2>
            <Link
              href="/admin/products?stock=low"
              className="text-sm text-amber-400 hover:text-amber-300"
            >
              Hamısı →
            </Link>
          </div>

          {lowStock.length === 0 ? (
            <EmptyState title="Bütün aktiv məhsullar kifayət qədər stokdadır" />
          ) : (
            <ul className="card divide-y divide-zinc-800">
              {lowStock.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">
                        {product.name}
                      </p>
                      <p className="font-mono text-xs text-zinc-500">
                        {product.sku}
                      </p>
                    </div>

                    <Badge tone={product.stock === 0 ? "red" : "amber"}>
                      {product.stock} əd.
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}
      </div>
    </>
  );
}
