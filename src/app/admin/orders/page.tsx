import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  priceGroupLabels,
  revisionStatusLabels,
  revisionStatusTones,
  shortId,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Sifarişlər",
};

const statusTabs = [
  { value: "", label: "Hamısı" },
  { value: "PENDING", label: orderStatusLabels.PENDING },
  { value: "CONFIRMED", label: orderStatusLabels.CONFIRMED },
  { value: "CANCELLED", label: orderStatusLabels.CANCELLED },
] as const;

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const params = await searchParams;
  const statusFilter =
    typeof params.status === "string" ? params.status : "";

  const { supabase } = await requireStaff("ordersView");

  const [{ data: orders, error }, { data: revisionStates }] = await Promise.all([
    supabase.rpc("get_admin_orders"),
    supabase.rpc("get_admin_order_revision_states"),
  ]);
  const revisionByOrder = new Map(
    (revisionStates ?? []).map((state) => [state.order_id, state])
  );

  if (error) {
    return (
      <>
        <PageHeader title="Sifarişlər" />
        <Alert>Sifarişlər yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const allOrders = orders ?? [];
  const visibleOrders = statusFilter
    ? allOrders.filter((order) => order.status === statusFilter)
    : allOrders;

  const countFor = (status: string) =>
    status
      ? allOrders.filter((order) => order.status === status).length
      : allOrders.length;

  return (
    <>
      <PageHeader
        title="Sifarişlər"
        description="Sifarişi təsdiqləyin, ləğv edin və ya dəyişiklik edib müştəriyə göndərin."
      />

      <nav
        aria-label="Status filtri"
        className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {statusTabs.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value ? `/admin/orders?status=${tab.value}` : "/admin/orders"}
            className={`btn btn-sm ${
              statusFilter === tab.value ? "btn-primary" : "btn-secondary"
            }`}
          >
            {tab.label}
            <span className="opacity-70">{countFor(tab.value)}</span>
          </Link>
        ))}
      </nav>

      {visibleOrders.length === 0 ? (
        <EmptyState
          title={
            allOrders.length === 0
              ? "Hələ sifariş yoxdur"
              : "Bu statusda sifariş yoxdur"
          }
        />
      ) : (
        <>
          {/* Phones: cards instead of a wide table. */}
          <ul className="space-y-3 md:hidden">
            {visibleOrders.map((order) => {
              const revision = revisionByOrder.get(order.order_id);

              return (
                <li key={order.order_id}>
                  <Link
                    href={`/admin/orders/${order.order_id}`}
                    className="card block p-4 hover:border-zinc-600"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono font-medium text-white">
                          #{shortId(order.order_id)}
                        </p>
                        <p className="truncate text-sm text-zinc-300">
                          {order.company_name ?? "—"} · {priceGroupLabels[order.price_group]}
                        </p>
                        <p className="text-xs text-zinc-500">{formatDate(order.created_at)}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-white">
                        {formatAzn(order.total_amount)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={orderStatusTones[order.status]}>
                        {orderStatusLabels[order.status]}
                      </Badge>
                      {revision && (
                        <Badge tone={revisionStatusTones[revision.status]}>
                          V{revision.version}: {revisionStatusLabels[revision.status]}
                        </Badge>
                      )}
                      <span className="text-xs text-zinc-500">{order.item_count} məhsul</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="table-wrap hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Sifariş</th>
                  <th>Müştəri</th>
                  <th>Status</th>
                  <th className="text-right">Məbləğ</th>
                  <th className="sr-only">Əməliyyat</th>
                </tr>
              </thead>

              <tbody>
                {visibleOrders.map((order) => {
                  const revision = revisionByOrder.get(order.order_id);

                  return (
                    <tr key={order.order_id} className="hover:bg-zinc-900/60">
                      <td className="whitespace-nowrap">
                        <Link
                          href={`/admin/orders/${order.order_id}`}
                          className="font-mono font-medium text-white hover:text-amber-400"
                        >
                          #{shortId(order.order_id)}
                        </Link>
                        <span className="block text-xs text-zinc-500">
                          {formatDate(order.created_at)}
                        </span>
                      </td>
                      <td className="max-w-56">
                        <span className="block truncate text-zinc-200">
                          {order.company_name ?? "—"}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {priceGroupLabels[order.price_group]} · {order.item_count} məhsul
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={orderStatusTones[order.status]}>
                            {orderStatusLabels[order.status]}
                          </Badge>
                          {revision && (
                            <Badge tone={revisionStatusTones[revision.status]}>
                              V{revision.version}: {revisionStatusLabels[revision.status]}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-right font-semibold whitespace-nowrap text-white">
                        {formatAzn(order.total_amount)}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/admin/orders/${order.order_id}`}
                          className={`btn btn-sm whitespace-nowrap ${
                            order.status === "PENDING" ? "btn-primary" : "btn-secondary"
                          }`}
                        >
                          {order.status === "PENDING" ? "Bax" : "Ətraflı"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
