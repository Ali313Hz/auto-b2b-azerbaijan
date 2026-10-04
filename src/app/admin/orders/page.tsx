import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  priceGroupLabels,
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

  const { supabase } = await requireOwner();

  const { data: orders, error } = await supabase.rpc("get_admin_orders");

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
        description="Gözləyən sifarişləri təsdiqləyin və ya ləğv edin. Ləğv zamanı stok avtomatik geri qaytarılır."
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sifariş</th>
                <th>Müştəri</th>
                <th>Tarix</th>
                <th>Status</th>
                <th className="text-right">Məhsul</th>
                <th className="text-right">Məbləğ</th>
                <th className="sr-only">Əməliyyat</th>
              </tr>
            </thead>

            <tbody>
              {visibleOrders.map((order) => (
                <tr key={order.order_id} className="hover:bg-zinc-900/60">
                  <td>
                    <Link
                      href={`/admin/orders/${order.order_id}`}
                      className="font-mono font-medium text-white hover:text-amber-400"
                    >
                      #{shortId(order.order_id)}
                    </Link>
                  </td>
                  <td className="max-w-56">
                    <span className="block truncate text-zinc-200">
                      {order.company_name ?? "—"}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {priceGroupLabels[order.price_group]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-zinc-400">
                    {formatDate(order.created_at)}
                  </td>
                  <td>
                    <Badge tone={orderStatusTones[order.status]}>
                      {orderStatusLabels[order.status]}
                    </Badge>
                  </td>
                  <td className="text-right">{order.item_count}</td>
                  <td className="text-right font-semibold whitespace-nowrap text-white">
                    {formatAzn(order.total_amount)}
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/admin/orders/${order.order_id}`}
                      className={`btn btn-sm ${
                        order.status === "PENDING" ? "btn-primary" : "btn-secondary"
                      }`}
                    >
                      {order.status === "PENDING" ? "Bax və təsdiqlə" : "Ətraflı"}
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
