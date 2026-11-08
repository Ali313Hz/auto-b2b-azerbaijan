import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import ConfirmForm from "@/components/ConfirmForm";
import RevisionDiff from "@/components/RevisionDiff";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  priceGroupLabels,
  revisionItems,
  revisionStatusLabels,
  revisionStatusTones,
  shortId,
  type RevisionItem,
} from "@/lib/format";

import {
  createOrderRevision,
  discardOrderRevision,
  resendOrderRevision,
  updateOrderStatus,
} from "../actions";
import OrderRevisionEditor from "./OrderRevisionEditor";

export const metadata: Metadata = {
  title: "Sifariş",
};

function ItemCards({ items }: { items: RevisionItem[] }) {
  return (
    <ul className="divide-y divide-zinc-800">
      {items.map((item) => (
        <li key={item.product_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <div className="min-w-0">
            <p className="font-medium break-words text-white">{item.product_name}</p>
            <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
          </div>
          <p className="text-sm text-zinc-300">
            {item.quantity} əd. × {formatAzn(item.unit_price)} ={" "}
            <span className="font-semibold text-white">{formatAzn(item.line_total)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { supabase, role } = await requireStaff("ordersView");
  const canProcess = can(role, "ordersProcess");
  const canEdit = can(role, "ordersEdit");

  const [{ data: orders }, { data: lines, error: linesError }, { data: revisions, error: revisionsError }] =
    await Promise.all([
      supabase.rpc("get_admin_orders"),
      supabase.rpc("get_admin_order_lines", { p_order_id: id }),
      supabase.rpc("get_admin_order_revisions", { p_order_id: id }),
    ]);

  const order = orders?.find((item) => item.order_id === id);

  if (!order) {
    notFound();
  }

  const currentItems: RevisionItem[] = (lines ?? []).map((line) => ({
    product_id: line.product_id,
    sku: line.sku,
    product_name: line.product_name,
    quantity: line.quantity,
    unit_price: Number(line.unit_price),
    line_total: Number(line.line_total),
  }));
  const history = revisions ?? [];
  const draft = history.find((revision) => revision.status === "DRAFT");
  const awaiting = history.find((revision) => revision.status === "AWAITING_CUSTOMER");
  const latest = history[0];
  const isCancelled = order.status === "CANCELLED";
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
          <div className="flex flex-wrap gap-2">
            <Badge tone={orderStatusTones[order.status]}>
              {orderStatusLabels[order.status]}
            </Badge>
            {latest && latest.version > 1 && (
              <Badge tone={revisionStatusTones[latest.status]}>
                V{latest.version}: {revisionStatusLabels[latest.status]}
              </Badge>
            )}
          </div>
        }
      />

      {latest?.status === "REJECTED" && (
        <Alert tone="amber">
          Müştəri dəyişiklikləri qəbul etmədi (Versiya {latest.version}
          {latest.responded_at ? `, ${formatDate(latest.responded_at)}` : ""}).
          Sifariş əvvəlki kimi qalır. Yeni dəyişiklik yarada və ya sifarişi
          olduğu kimi təsdiqləyə bilərsiniz.
        </Alert>
      )}

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
            <div className="mt-3">
              <Badge tone="blue">{priceGroupLabels[order.price_group]}</Badge>
            </div>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              Əməliyyatlar
            </h2>

            {order.status === "PENDING" && canProcess && (
              <>
                <ConfirmForm
                  action={updateOrderStatus}
                  fields={{ ...fields, status: "CONFIRMED" }}
                  label="Sifarişi təsdiqlə"
                  question="Bu sifarişi təsdiqləmək istəyirsiniz?"
                  description={
                    awaiting || draft
                      ? "Sifariş hazırkı məhsullarla təsdiqlənəcək; açıq dəyişiklik geri çağırılacaq."
                      : "Sifariş hazırkı məhsullar və qiymətlərlə təsdiqlənəcək."
                  }
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

            {canEdit && !isCancelled && !draft && !awaiting && (
              <ActionForm action={createOrderRevision}>
                <input type="hidden" name="orderId" value={order.order_id} />
                <SubmitButton className="btn btn-secondary w-full" pendingText="Açılır...">
                  {order.status === "CONFIRMED" ? "Yeni dəyişiklik yarat" : "Sifarişi dəyiş"}
                </SubmitButton>
              </ActionForm>
            )}

            <p className="text-xs text-zinc-500">
              Son yenilənmə: {formatDate(order.updated_at)}.{" "}
              {isCancelled
                ? "Ləğv edilmiş sifariş dəyişdirilə bilməz."
                : !canProcess && !canEdit
                  ? "Rolunuz yalnız baxmağa icazə verir."
                  : !canEdit
                    ? "Miqdar və qiymət dəyişikliyi yalnız Sahib və Satış rolları üçündür."
                    : ""}
            </p>
          </section>
        </aside>

        <div className="min-w-0 space-y-6">
          {draft && canEdit && (
            <>
              <OrderRevisionEditor
                key={draft.id}
                orderId={order.order_id}
                revisionId={draft.id}
                version={draft.version}
                initialItems={revisionItems(draft.items)}
                initialNote={draft.note ?? ""}
                currentItems={currentItems}
                priceGroupLabel={priceGroupLabels[order.price_group]}
              />
              <ConfirmForm
                action={discardOrderRevision}
                fields={{ ...fields, revisionId: draft.id }}
                label="Qaralamanı ləğv et"
                question="Qaralama ləğv edilsin?"
                description="Sifariş dəyişmir. Qaralama tarixçədə “Geri çağırılıb” kimi qalır."
                confirmLabel="Bəli, ləğv et"
                pendingText="Ləğv edilir..."
                tone="secondary"
                className="max-w-xs"
              />
            </>
          )}

          {draft && !canEdit && (
            <Alert tone="amber">
              Satış komandası bu sifariş üçün dəyişiklik hazırlayır (Versiya {draft.version}).
            </Alert>
          )}

          {awaiting && (
            <section className="card space-y-4 border-amber-800/60 p-4 sm:p-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">
                    Müştəri cavabı gözlənilir
                  </h2>
                  <Badge tone="amber">Versiya {awaiting.version}</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-400">
                  Göndərilib: {awaiting.sent_at ? formatDate(awaiting.sent_at) : "—"}
                  {awaiting.sent_count > 1 &&
                    ` · ${awaiting.sent_count} dəfə, sonuncu ${formatDate(awaiting.last_sent_at!)}`}
                  . Müştəri qəbul edənə qədər sifariş və stok dəyişmir.
                </p>
              </div>

              <RevisionDiff
                before={currentItems}
                after={revisionItems(awaiting.items)}
                beforeTotal={Number(order.total_amount)}
                afterTotal={Number(awaiting.total_amount)}
              />

              {awaiting.note && (
                <div className="rounded-lg border border-zinc-800 p-3 text-sm">
                  <p className="text-xs text-zinc-500">Satıcı qeydi</p>
                  <p className="whitespace-pre-line text-zinc-200">{awaiting.note}</p>
                </div>
              )}

              {canEdit && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <ConfirmForm
                    action={resendOrderRevision}
                    fields={{ ...fields, revisionId: awaiting.id }}
                    label="Yenidən göndər"
                    question="Müştəriyə yenidən göstərilsin?"
                    description="Yeni versiya yaranmır; müştərinin ekranında xəbərdarlıq yenidən önə çıxır."
                    pendingText="Göndərilir..."
                    tone="secondary"
                  />
                  <ConfirmForm
                    action={createOrderRevision}
                    fields={fields}
                    label="Düzəliş et"
                    question="Bu dəyişiklik geri çağırılıb yeni versiya açılsın?"
                    description="Müştəri hazırkı versiyanı artıq qəbul edə bilməyəcək."
                    pendingText="Açılır..."
                    tone="secondary"
                  />
                  <ConfirmForm
                    action={discardOrderRevision}
                    fields={{ ...fields, revisionId: awaiting.id }}
                    label="Geri çağır"
                    question="Dəyişiklik geri çağırılsın?"
                    description="Sifariş əvvəlki kimi qalır."
                    confirmLabel="Bəli, geri çağır"
                    pendingText="Geri çağırılır..."
                    tone="danger"
                  />
                </div>
              )}
            </section>
          )}

          <section className="card p-4 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">
                {order.status === "CONFIRMED" ? "Təsdiqlənmiş məhsullar" : "Hazırkı məhsullar"}
              </h2>
              <p className="text-xl font-bold text-amber-400">{formatAzn(order.total_amount)}</p>
            </div>
            {linesError ? (
              <Alert>Sifariş məhsulları yüklənmədi.</Alert>
            ) : (
              <ItemCards items={currentItems} />
            )}
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="mb-1 text-lg font-semibold text-white">Dəyişiklik tarixçəsi</h2>
            <p className="mb-4 text-sm text-zinc-400">
              Heç bir versiya silinmir.
            </p>

            {revisionsError ? (
              <Alert>Tarixçə yüklənmədi.</Alert>
            ) : history.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Versiya 1 · Orijinal sifariş ({formatDate(order.created_at)}). Hələ dəyişiklik edilməyib.
              </p>
            ) : (
              <ol className="space-y-2">
                {history.map((revision) => (
                  <li key={revision.id}>
                    <details className="rounded-lg border border-zinc-800 p-3">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">
                          Versiya {revision.version}
                          {revision.version === 1 ? " · Orijinal sifariş" : ""}
                        </span>
                        <Badge tone={revisionStatusTones[revision.status]}>
                          {revision.version === 1 ? "Müştəri göndərdi" : revisionStatusLabels[revision.status]}
                        </Badge>
                        <span className="ml-auto text-sm font-semibold text-zinc-200">
                          {formatAzn(revision.total_amount)}
                        </span>
                      </summary>
                      <p className="mt-2 text-xs text-zinc-500">
                        {revision.created_by_name ?? "—"} · {formatDate(revision.created_at)}
                        {revision.sent_at && ` · göndərilib ${formatDate(revision.sent_at)}`}
                        {revision.responded_at && revision.version > 1 &&
                          ` · cavab ${formatDate(revision.responded_at)}`}
                      </p>
                      {revision.note && (
                        <p className="mt-2 text-sm whitespace-pre-line text-zinc-300">
                          Qeyd: {revision.note}
                        </p>
                      )}
                      <ItemCards items={revisionItems(revision.items)} />
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
