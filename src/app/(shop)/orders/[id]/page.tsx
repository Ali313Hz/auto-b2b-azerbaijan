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
import {
  describeOrderChange,
  groupOrderChanges,
  type OrderChangeGroup,
} from "@/lib/order-changes";

export const metadata: Metadata = {
  title: "Sifariş",
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: PageProps<"/orders/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireCustomer();

  // All RPCs only return rows owned by the signed-in customer.
  const [{ data: orders }, { data: lines, error: linesError }, { data: changes }] =
    await Promise.all([
      supabase.rpc("get_customer_orders"),
      supabase.rpc("get_customer_order_lines", { p_order_id: id }),
      supabase.rpc("get_customer_order_changes", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  const groups = groupOrderChanges(changes ?? []).filter((group) => group.rows.length > 0);
  const [latest, ...older] = groups;

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

      {latest && (
        <section
          aria-labelledby="change-title"
          className="mb-6 rounded-xl border border-sky-700/70 bg-sky-950/20 p-4 sm:p-5"
        >
          <h2 id="change-title" className="font-semibold text-sky-200">
            Satıcı tərəfindən sifariş yenilənib
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {formatDate(latest.created_at)} · Aşağıdakı siyahı sifarişinizin hazırkı halıdır.
          </p>

          <ChangeList group={latest} />

          {older.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                Əvvəlki dəyişikliklər ({older.length})
              </summary>
              <div className="mt-2 space-y-3">
                {older.map((group) => (
                  <div key={group.change_id} className="rounded-lg border border-zinc-800 p-3">
                    <p className="text-xs text-zinc-500">{formatDate(group.created_at)}</p>
                    <ChangeList group={group} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Məhsullar</h2>
          <p className="text-xl font-bold text-amber-400">{formatAzn(order.total_amount)}</p>
        </div>

        {linesError ? (
          <Alert>Sifariş məhsulları yüklənmədi.</Alert>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {(lines ?? []).map((item) => (
              <li
                key={item.product_id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words text-white">{item.product_name}</p>
                  {item.product_name !== item.sku && (
                    <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
                  )}
                </div>
                <p className="text-sm text-zinc-300">
                  {item.quantity} əd. × {formatAzn(item.unit_price)} ={" "}
                  <span className="font-semibold text-white">{formatAzn(item.line_total)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ChangeList({ group }: { group: OrderChangeGroup }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {group.rows.map((row) => {
        const change = describeOrderChange(row);

        return (
          <li key={`${row.change_type}-${row.sku}`} className="min-w-0">
            <span className="font-medium break-words text-white">{change.title}</span>
            {change.lines.map((line) => (
              <span key={line} className="block text-zinc-300">
                {line}
              </span>
            ))}
          </li>
        );
      })}
      {group.total_before !== null && group.total_after !== null && group.total_before !== group.total_after && (
        <li className="border-t border-zinc-800 pt-2 text-zinc-300">
          Cəm: {formatAzn(group.total_before)} → <span className="font-semibold text-white">{formatAzn(group.total_after)}</span>
        </li>
      )}
    </ul>
  );
}
