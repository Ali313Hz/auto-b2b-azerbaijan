import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  shortId,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Sifariş",
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: PageProps<"/orders/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireCustomer();

  // Both RPCs only return rows owned by the signed-in customer.
  const [{ data: orders }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.rpc("get_customer_orders"),
      supabase.rpc("get_customer_order_items", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  return (
    <>
      <Link
        href="/orders"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Bütün sifarişlər
      </Link>

      {query.created === "1" && (
        <Alert tone="green">
          Sifarişiniz qəbul edildi. Administrator təsdiqlədikdə status
          yenilənəcək.
        </Alert>
      )}

      <PageHeader
        title={`Sifariş #${shortId(order.order_id)}`}
        description={formatDate(order.created_at)}
        actions={
          <Badge tone={orderStatusTones[order.status]}>
            {orderStatusLabels[order.status]}
          </Badge>
        }
      />

      {itemsError ? (
        <Alert>Sifariş məhsulları yüklənmədi.</Alert>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="text-right">Miqdar</th>
                <th className="text-right">Vahid qiymət</th>
                <th className="text-right">Məbləğ</th>
              </tr>
            </thead>

            <tbody>
              {(items ?? []).map((item, index) => (
                <tr key={`${item.product_id}-${index}`}>
                  <td className="font-mono text-white">{item.sku}</td>
                  <td className="text-right">{item.quantity}</td>
                  <td className="text-right text-zinc-400">
                    {formatAzn(item.unit_price)}
                  </td>
                  <td className="text-right font-semibold text-white">
                    {formatAzn(item.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right text-zinc-400">
                  Cəmi
                </td>
                <td className="px-4 py-3 text-right text-lg font-bold text-amber-400">
                  {formatAzn(order.total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
