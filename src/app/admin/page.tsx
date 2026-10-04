import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  shortId,
} from "@/lib/format";

const LOW_STOCK_THRESHOLD = 5;

export default async function AdminPage() {
  const { supabase } = await requireOwner();

  const [ordersResult, productsResult, customersResult] = await Promise.all([
    supabase.rpc("get_admin_orders"),
    supabase.rpc("get_admin_products"),
    supabase.rpc("get_admin_customers"),
  ]);

  const orders = ordersResult.data ?? [];
  const products = productsResult.data ?? [];
  const customers = customersResult.data ?? [];
  const hasError =
    ordersResult.error || productsResult.error || customersResult.error;

  const pendingOrders = orders.filter((order) => order.status === "PENDING");
  const activeProducts = products.filter((product) => product.active);
  const lowStock = activeProducts
    .filter((product) => product.stock <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock);
  const activeCustomers = customers.filter(
    (customer) => customer.active && !customer.archived_at
  );

  const stats = [
    {
      label: "Gözləyən sifarişlər",
      value: pendingOrders.length,
      href: "/admin/orders?status=PENDING",
      highlight: pendingOrders.length > 0,
    },
    {
      label: "Aktiv məhsullar",
      value: `${activeProducts.length} / ${products.length}`,
      href: "/admin/products",
    },
    {
      label: "Az stoklu məhsullar",
      value: lowStock.length,
      href: "/admin/products?stock=low",
      highlight: lowStock.length > 0,
    },
    {
      label: "Aktiv müştərilər",
      value: activeCustomers.length,
      href: "/admin/customers",
    },
  ];

  return (
    <>
      <PageHeader
        title="İdarə paneli"
        description="Sifarişlər, məhsullar və müştərilər üzrə qısa baxış."
      />

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

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
              {lowStock.slice(0, 6).map((product) => (
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
      </div>
    </>
  );
}
