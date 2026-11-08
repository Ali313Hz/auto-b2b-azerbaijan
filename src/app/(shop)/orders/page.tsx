import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  shortId,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Sifarişlər",
};

export default async function OrdersPage() {
  const { supabase } = await requireCustomer();

  const [{ data: orders, error }, { data: alerts }] = await Promise.all([
    supabase.rpc("get_customer_orders"),
    supabase.rpc("get_customer_order_alerts"),
  ]);
  const changed = new Set((alerts ?? []).map((alert) => alert.order_id));

  if (error) {
    return (
      <>
        <PageHeader title="Sifarişlər" />
        <Alert>Sifarişlər yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <>
        <PageHeader title="Sifarişlər" />
        <EmptyState
          title="Hələ sifarişiniz yoxdur"
          description="Kataloqdan məhsul seçib ilk sifarişinizi verin."
          action={
            <Link href="/products" className="btn btn-primary">
              Kataloqa keç
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sifarişlər"
        description={`Cəmi ${orders.length} sifariş`}
      />

      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.order_id}>
            <Link
              href={`/orders/${order.order_id}`}
              className={`card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-zinc-600 ${
                changed.has(order.order_id) ? "border-amber-500/70" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-mono font-medium text-white">
                  #{shortId(order.order_id)}
                </p>
                <p className="text-sm text-zinc-400">{formatDate(order.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {changed.has(order.order_id) && (
                  <Badge tone="amber">Dəyişiklik var · cavabınızı gözləyir</Badge>
                )}
                <Badge tone={orderStatusTones[order.status]}>
                  {orderStatusLabels[order.status]}
                </Badge>
                <span className="font-semibold whitespace-nowrap text-white">
                  {formatAzn(order.total_amount)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
