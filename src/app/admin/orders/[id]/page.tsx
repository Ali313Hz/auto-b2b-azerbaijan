import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ConfirmForm from "@/components/ConfirmForm";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  shortId,
} from "@/lib/format";
import {
  describeOrderChange,
  groupOrderChanges,
  type OrderChange,
} from "@/lib/order-changes";

import { updateOrderStatus } from "../actions";
import OrderEditor, { type OrderLine } from "./OrderEditor";

export const metadata: Metadata = {
  title: "Sifariş",
};

type JsonObject = Record<string, unknown> | null;

const num = (value: unknown) => (typeof value === "number" ? value : value == null ? null : Number(value));

export default async function AdminOrderDetailPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { supabase, role } = await requireStaff("ordersView");
  const canProcess = can(role, "ordersProcess");
  const canEdit = can(role, "ordersEdit");
  // WAREHOUSE does not see prices in the history (the database hides them).
  const showPrices = role !== "WAREHOUSE";

  const [{ data: orders }, { data: lineRows, error: linesError }, { data: changeRows, error: changesError }] =
    await Promise.all([
      supabase.rpc("get_admin_orders"),
      supabase.rpc("get_admin_order_lines", { p_order_id: id }),
      supabase.rpc("get_admin_order_changes", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  const lines: OrderLine[] = (lineRows ?? []).map((line) => ({
    product_id: line.product_id,
    sku: line.sku,
    product_name: line.product_name,
    quantity: line.quantity,
    unit_price: Number(line.unit_price),
    stock: line.stock,
  }));

  const changes: OrderChange[] = (changeRows ?? []).map((row) => {
    const before = row.before as JsonObject;
    const after = row.after as JsonObject;

    return {
      change_id: row.change_id,
      change_type: row.change_type,
      product_name: row.product_name,
      sku: row.sku,
      quantity_before: num(before?.quantity),
      quantity_after: num(after?.quantity),
      price_before: num(before?.unit_price ?? before?.total),
      price_after: num(after?.unit_price ?? after?.total),
      status_before: (before?.status as string) ?? null,
      status_after: (after?.status as string) ?? null,
      actor_name: row.actor_name,
      created_at: row.created_at,
    };
  });
  const history = groupOrderChanges(changes);
  const isPending = order.status === "PENDING";
  const fields = { orderId: order.order_id };

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
        description={`${formatDate(order.created_at)} · ${order.company_name ?? "—"}`}
        actions={
          <Badge tone={orderStatusTones[order.status]}>
            {orderStatusLabels[order.status]}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <aside className="space-y-4 lg:order-last">
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
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Əməliyyatlar
            </h2>

            {isPending && canProcess && (
              <>
                <ConfirmForm
                  action={updateOrderStatus}
                  fields={{ ...fields, status: "CONFIRMED" }}
                  label="Sifarişi təsdiqlə"
                  question="Bu sifarişi təsdiqləmək istəyirsiniz?"
                  description={`Sifariş hazırkı məhsullar və qiymətlərlə təsdiqlənəcək (${formatAzn(order.total_amount)}). Təsdiqdən sonra dəyişmək olmur.`}
                  pendingText="Təsdiqlənir..."
                  tone="success"
                />
                <ConfirmForm
                  action={updateOrderStatus}
                  fields={{ ...fields, status: "CANCELLED" }}
                  label="Sifarişi ləğv et"
                  question="Bu sifarişi ləğv etmək istəyirsiniz?"
                  description="Məhsullar stoka geri qaytarılacaq. Bu əməliyyat geri qaytarılmır."
                  confirmLabel="Bəli, ləğv et"
                  pendingText="Ləğv edilir..."
                  tone="danger"
                />
              </>
            )}

            <p className="text-xs text-zinc-500">
              Son yenilənmə: {formatDate(order.updated_at)}.{" "}
              {!isPending
                ? "Təsdiqlənmiş və ya ləğv edilmiş sifariş dəyişdirilmir."
                : !canProcess && !canEdit
                  ? "Rolunuz yalnız baxmağa icazə verir."
                  : !canEdit
                    ? "Miqdar və qiymət dəyişikliyi yalnız Sahib və Satış rolları üçündür."
                    : "Müştəri ilə telefonla razılaşdıqdan sonra “Sifarişi təsdiqlə” basın."}
            </p>
          </section>
        </aside>

        <div className="min-w-0 space-y-6">
          {linesError ? (
            <Alert>Sifariş məhsulları yüklənmədi.</Alert>
          ) : isPending && canEdit ? (
            <OrderEditor orderId={order.order_id} updatedAt={order.updated_at} lines={lines} />
          ) : (
            <section className="card p-4 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-white">Məhsullar</h2>
                <p className="text-xl font-bold text-amber-400">{formatAzn(order.total_amount)}</p>
              </div>
              <ul className="divide-y divide-zinc-800">
                {lines.map((line) => (
                  <li
                    key={line.product_id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words text-white">{line.product_name}</p>
                      <p className="font-mono text-xs text-zinc-500">{line.sku}</p>
                    </div>
                    <p className="text-sm text-zinc-300">
                      {line.quantity} əd. × {formatAzn(line.unit_price)} ={" "}
                      <span className="font-semibold text-white">
                        {formatAzn(Math.round(line.quantity * line.unit_price * 100) / 100)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4 sm:p-6">
            <h2 className="mb-1 text-lg font-semibold text-white">Dəyişiklik tarixçəsi</h2>
            <p className="mb-4 text-sm text-zinc-400">
              Kim, nə vaxt, nəyi dəyişdi. Tarixçə silinmir.
            </p>

            {changesError ? (
              <Alert>Tarixçə yüklənmədi.</Alert>
            ) : (
              <ol className="space-y-3">
                {history.map((group) => (
                  <li key={group.change_id} className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs text-zinc-500">
                      {formatDate(group.created_at)} · {group.actor_name ?? "—"}
                    </p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {group.rows.map((row) => {
                        const change = describeOrderChange(row, showPrices);

                        return (
                          <li key={`${row.change_type}-${row.sku}`}>
                            <span className="font-medium text-white">{change.title}</span>
                            {change.lines.map((line) => (
                              <span key={line} className="block text-zinc-300">
                                {line}
                              </span>
                            ))}
                          </li>
                        );
                      })}
                      {showPrices && group.total_before !== null && group.total_after !== null && (
                        <li className="text-zinc-400">
                          Cəm: {formatAzn(group.total_before)} → {formatAzn(group.total_after)}
                        </li>
                      )}
                    </ul>
                  </li>
                ))}
                <li className="rounded-lg border border-zinc-800 p-3 text-sm">
                  <p className="text-xs text-zinc-500">{formatDate(order.created_at)}</p>
                  <p className="text-zinc-300">Müştəri sifarişi göndərdi.</p>
                </li>
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
