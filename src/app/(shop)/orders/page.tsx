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

  const { data: orders, error } = await supabase.rpc("get_customer_orders");

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

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Sifariş</th>
              <th>Tarix</th>
              <th>Status</th>
              <th className="text-right">Məbləğ</th>
              <th className="sr-only">Ətraflı</th>
            </tr>
          </thead>

          <tbody>
            {orders.map((order) => (
              <tr key={order.order_id} className="hover:bg-zinc-900/60">
                <td className="font-mono font-medium text-white">
                  #{shortId(order.order_id)}
                </td>
                <td className="text-zinc-400">
                  {formatDate(order.created_at)}
                </td>
                <td>
                  <Badge tone={orderStatusTones[order.status]}>
                    {orderStatusLabels[order.status]}
                  </Badge>
                </td>
                <td className="text-right font-semibold text-white">
                  {formatAzn(order.total_amount)}
                </td>
                <td className="text-right">
                  <Link
                    href={`/orders/${order.order_id}`}
                    className="btn btn-secondary btn-sm"
                  >
                    Ətraflı
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
