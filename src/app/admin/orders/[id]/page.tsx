import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  priceGroupLabels,
  shortId,
} from "@/lib/format";

import { updateOrderStatus } from "../actions";

export const metadata: Metadata = {
  title: "Sifariş",
};

export default async function AdminOrderDetailPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { supabase } = await requireOwner();

  const [{ data: orders }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.rpc("get_admin_orders"),
      supabase.rpc("get_admin_order_items", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Sifarişlər
      </Link>

      <PageHeader
        title={`Sifariş #${shortId(order.order_id)}`}
        description={`${formatDate(order.created_at)} · ID: ${order.order_id}`}
        actions={
          <Badge tone={orderStatusTones[order.status]}>
            {orderStatusLabels[order.status]}
          </Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0">
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
                  {(items ?? []).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          href={`/admin/products/${item.product_id}`}
                          className="font-mono text-white hover:text-amber-400"
                        >
                          {item.sku}
                        </Link>
                      </td>
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
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Müştəri
            </h2>

            <Link
              href={`/admin/customers/${order.customer_id}`}
              className="mt-2 block font-semibold break-words text-white hover:text-amber-400"
            >
              {order.company_name ?? "—"}
            </Link>
            <p className="text-sm text-zinc-300">{order.contact_name ?? "—"}</p>
            <p className="text-sm break-all text-zinc-500">{order.email ?? "—"}</p>
            <div className="mt-3">
              <Badge tone="blue">{priceGroupLabels[order.price_group]}</Badge>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Status
            </h2>

            {order.status === "PENDING" ? (
              <div className="mt-3 space-y-3">
                <ActionForm action={updateOrderStatus}>
                  <input type="hidden" name="orderId" value={order.order_id} />
                  <input type="hidden" name="status" value="CONFIRMED" />
                  <SubmitButton
                    className="btn btn-success w-full"
                    pendingText="Təsdiqlənir..."
                  >
                    Sifarişi təsdiqlə
                  </SubmitButton>
                </ActionForm>

                <ActionForm
                  action={updateOrderStatus}
                  confirmMessage="Sifariş ləğv edilsin? Məhsullar stoka geri qaytarılacaq. Bu əməliyyat geri qaytarılmır."
                >
                  <input type="hidden" name="orderId" value={order.order_id} />
                  <input type="hidden" name="status" value="CANCELLED" />
                  <SubmitButton
                    className="btn btn-danger w-full"
                    pendingText="Ləğv edilir..."
                  >
                    Sifarişi ləğv et
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Son yenilənmə: {formatDate(order.updated_at)}. Yalnız gözləyən
                sifarişlərin statusu dəyişdirilə bilər.
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
