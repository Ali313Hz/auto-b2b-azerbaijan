import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ConfirmForm from "@/components/ConfirmForm";
import RevisionDiff from "@/components/RevisionDiff";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  revisionItems,
  shortId,
  type RevisionItem,
} from "@/lib/format";

import { respondToOrderRevision } from "../actions";

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
  const [{ data: orders }, { data: items, error: itemsError }, { data: revisions }] =
    await Promise.all([
      supabase.rpc("get_customer_orders"),
      supabase.rpc("get_customer_order_items", { p_order_id: id }),
      supabase.rpc("get_customer_order_revisions", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  const history = revisions ?? [];
  const awaiting =
    order.status !== "CANCELLED"
      ? history.find((revision) => revision.status === "AWAITING_CUSTOMER")
      : undefined;
  const accepted = history.find((revision) => revision.status === "ACCEPTED");
  const latest = history[0];

  // Product names come from the accepted version when there is one.
  const names = new Map(
    revisionItems(accepted?.items).map((item) => [item.product_id, item.product_name])
  );
  const currentItems: RevisionItem[] = (items ?? []).map((item) => ({
    product_id: item.product_id,
    sku: item.sku,
    product_name: names.get(item.product_id) ?? item.sku,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    line_total: Number(item.line_total),
  }));

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

      {awaiting && (
        <section
          aria-labelledby="change-title"
          className="mb-6 space-y-4 rounded-xl border-2 border-amber-500/70 bg-amber-950/20 p-4 sm:p-6"
        >
          <div>
            <h2 id="change-title" className="text-xl font-bold text-amber-300">
              Sifarişinizdə dəyişiklik edilib
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              Satıcı sifarişinizi dəyişib
              {awaiting.last_sent_at ? ` (${formatDate(awaiting.last_sent_at)})` : ""}.
              Zəhmət olmasa yoxlayın və cavab verin. Siz qəbul edənə qədər
              sifarişiniz dəyişmir.
            </p>
          </div>

          <RevisionDiff
            before={currentItems}
            after={revisionItems(awaiting.items)}
            beforeTotal={Number(order.total_amount)}
            afterTotal={Number(awaiting.total_amount)}
          />

          {awaiting.note && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
              <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Satıcı qeydi
              </p>
              <p className="mt-1 whitespace-pre-line text-zinc-100">{awaiting.note}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ConfirmForm
              action={respondToOrderRevision}
              fields={{ orderId: order.order_id, revisionId: awaiting.id, answer: "accept" }}
              label="Dəyişiklikləri qəbul et"
              question="Dəyişiklikləri qəbul edirsiniz?"
              description={`Sifarişiniz yeni məhsul və qiymətlərlə təsdiqlənəcək. Yeni cəm: ${formatAzn(awaiting.total_amount)}.`}
              confirmLabel="Bəli, qəbul edirəm"
              pendingText="Qəbul edilir..."
              tone="success"
            />
            <ConfirmForm
              action={respondToOrderRevision}
              fields={{ orderId: order.order_id, revisionId: awaiting.id, answer: "reject" }}
              label="Razı deyiləm"
              question="Dəyişikliklərlə razı deyilsiniz?"
              description="Sifarişiniz silinmir və əvvəlki kimi qalır. Satıcı sizinlə əlaqə saxlayacaq."
              confirmLabel="Bəli, razı deyiləm"
              pendingText="Göndərilir..."
              tone="danger"
            />
          </div>
        </section>
      )}

      {!awaiting && latest?.status === "REJECTED" && (
        <Alert tone="amber">
          Satıcının dəyişikliklərini qəbul etmədiniz. Sifarişiniz əvvəlki kimi
          qalır; satıcı sizinlə əlaqə saxlayacaq.
        </Alert>
      )}

      {!awaiting && latest && latest.version > 1 && latest.status === "ACCEPTED" && (
        <Alert tone="green">
          Satıcının dəyişikliklərini qəbul etdiniz (Versiya {latest.version}
          {latest.responded_at ? `, ${formatDate(latest.responded_at)}` : ""}).
        </Alert>
      )}

      <section className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">
            {awaiting ? "Hazırkı sifariş" : "Məhsullar"}
          </h2>
          <p className="text-xl font-bold text-amber-400">{formatAzn(order.total_amount)}</p>
        </div>

        {itemsError ? (
          <Alert>Sifariş məhsulları yüklənmədi.</Alert>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {currentItems.map((item) => (
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

      {history.length > 1 && (
        <section className="card mt-6 p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold text-white">Dəyişiklik tarixçəsi</h2>
          <ol className="space-y-2 text-sm">
            {history.map((revision) => (
              <li
                key={revision.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2"
              >
                <span className="text-zinc-200">
                  Versiya {revision.version}
                  {revision.version === 1 ? " · Orijinal sifariş" : ""}
                </span>
                <span className="text-zinc-400">
                  {revision.version === 1
                    ? formatDate(revision.created_at)
                    : revision.status === "ACCEPTED"
                      ? "Qəbul etdiniz"
                      : revision.status === "REJECTED"
                        ? "Razı olmadınız"
                        : revision.status === "AWAITING_CUSTOMER"
                          ? "Cavabınızı gözləyir"
                          : "Satıcı geri çağırıb"}
                </span>
                <span className="font-semibold text-white">{formatAzn(revision.total_amount)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
