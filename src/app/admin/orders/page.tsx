import type { Metadata } from "next";
import Link from "next/link";

import Pagination, { pageHref } from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  paymentBadge,
  phoneHref,
  readPage,
  shortId,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Sifarişlər",
};

const PAGE_SIZE = 30;
const STATUSES = ["PENDING", "CONFIRMED", "CANCELLED"] as const;
const PAYMENTS = ["CUSTOMER_REPORTED", "UNPAID", "PAID", "REJECTED", "UNKNOWN"] as const;
const TYPES = ["STANDARD", "PREORDER"] as const;

const paymentTabs: { value: (typeof PAYMENTS)[number]; label: string }[] = [
  { value: "CUSTOMER_REPORTED", label: "Ödəniş bildirilib" },
  { value: "UNPAID", label: "Ödənilməyib" },
  { value: "PAID", label: "Ödənilib" },
  { value: "REJECTED", label: "Təsdiqlənmədi" },
];

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status) ?? "";
  const payment = PAYMENTS.find((value) => value === params.payment) ?? "";
  const type = TYPES.find((value) => value === params.type) ?? "";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = readPage(params.page);

  const { supabase } = await requireStaff("ordersView");

  // One page of orders; filters, search and counts run in the database.
  const [{ data: orders, error }, { data: countRows }] = await Promise.all([
    supabase.rpc("get_admin_orders_page", {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_status: status || null,
      p_payment: payment || null,
      p_search: query || null,
      p_type: type || null,
    }),
    supabase.rpc("get_admin_order_counts"),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title="Sifarişlər" />
        <Alert>Sifarişlər yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const rows = orders ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  const counts = countRows?.[0];
  const filters: Record<"status" | "payment" | "type" | "q", string | undefined> = {
    status: status || undefined,
    payment: payment || undefined,
    type: type || undefined,
    q: query || undefined,
  };
  const href = (next: Partial<typeof filters>) => pageHref("/admin/orders", { ...filters, ...next }, 1);

  const statusTabs = [
    { value: "", label: "Hamısı", count: counts?.total },
    { value: "PENDING", label: orderStatusLabels.PENDING, count: counts?.pending },
    { value: "CONFIRMED", label: orderStatusLabels.CONFIRMED, count: counts?.confirmed },
    { value: "CANCELLED", label: orderStatusLabels.CANCELLED, count: counts?.cancelled },
  ];
  const paymentCount: Record<string, number | undefined> = {
    CUSTOMER_REPORTED: counts?.payment_reported,
    UNPAID: counts?.unpaid,
    PAID: counts?.paid,
    REJECTED: counts?.rejected,
  };
  const reported = Number(counts?.payment_reported ?? 0);
  const typeTabs = [
    { value: "", label: "Hamısı", count: counts?.total },
    { value: "STANDARD", label: "Normal", count: counts?.standard },
    { value: "PREORDER", label: "Ön sifariş", count: counts?.preorder },
  ];
  const filtered = Boolean(status || payment || type || query);

  return (
    <>
      <PageHeader
        title="Sifarişlər"
        description="Sifarişi təsdiqləyin, ləğv edin, dəyişin və ödənişi yoxlayın."
      />

      {reported > 0 && payment !== "CUSTOMER_REPORTED" && (
        <Link
          href={href({ payment: "CUSTOMER_REPORTED", status: undefined })}
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-sky-600/70 bg-sky-950/40 p-3 text-sm text-sky-100 hover:border-sky-400"
        >
          <span>
            <span className="font-semibold">{reported} sifarişdə</span> müştəri ödəniş etdiyini
            bildirib — yoxlayıb təsdiqləyin.
          </span>
          <span className="btn btn-sm shrink-0 bg-sky-500 font-semibold text-zinc-950 hover:bg-sky-400">
            Göstər
          </span>
        </Link>
      )}

      <nav aria-label="Sifariş növü" className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {typeTabs.map((tab) => (
          <Link
            key={tab.value}
            href={href({ type: tab.value || undefined })}
            className={`btn btn-sm whitespace-nowrap ${type === tab.value ? "btn-primary" : "btn-secondary"}`}
          >
            {tab.label}
            <span className="opacity-70">{tab.count ?? ""}</span>
          </Link>
        ))}
      </nav>

      <nav aria-label="Status filtri" className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {statusTabs.map((tab) => (
          <Link
            key={tab.value}
            href={href({ status: tab.value || undefined })}
            className={`btn btn-sm whitespace-nowrap ${status === tab.value ? "btn-primary" : "btn-secondary"}`}
          >
            {tab.label}
            <span className="opacity-70">{tab.count ?? ""}</span>
          </Link>
        ))}
      </nav>

      <nav aria-label="Ödəniş filtri" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link
          href={href({ payment: undefined })}
          className={`btn btn-sm whitespace-nowrap ${payment ? "btn-secondary" : "btn-primary"}`}
        >
          Bütün ödənişlər
        </Link>
        {paymentTabs.map((tab) => (
          <Link
            key={tab.value}
            href={href({ payment: tab.value })}
            className={`btn btn-sm whitespace-nowrap ${
              payment === tab.value
                ? "btn-primary"
                : tab.value === "CUSTOMER_REPORTED" && reported > 0
                  ? "border border-sky-500 bg-sky-950/60 text-sky-200"
                  : "btn-secondary"
            }`}
          >
            {tab.label}
            <span className="opacity-70">{paymentCount[tab.value] ?? ""}</span>
          </Link>
        ))}
      </nav>

      <form action="/admin/orders" className="mb-4 flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        {payment && <input type="hidden" name="payment" value={payment} />}
        {type && <input type="hidden" name="type" value={type} />}
        <label htmlFor="order-search" className="sr-only">
          Sifariş axtar
        </label>
        <input
          id="order-search"
          type="search"
          name="q"
          defaultValue={query}
          maxLength={100}
          placeholder="Şirkət, əlaqə şəxsi, telefon və ya sifariş nömrəsi"
          className="input min-w-0 flex-1 sm:max-w-md"
        />
        <button type="submit" className="btn btn-secondary">
          Axtar
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Uyğun sifariş yoxdur" : "Hələ sifariş yoxdur"}
          action={
            filtered ? (
              <Link href="/admin/orders" className="btn btn-secondary">
                Filtrləri sıfırla
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Phones: cards instead of a wide table. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((order) => {
              const paid = paymentBadge(order.payment_status);
              const tel = order.phone ? phoneHref(order.phone) : null;

              return (
                <li
                  key={order.order_id}
                  className={`card p-4 ${order.payment_status === "CUSTOMER_REPORTED" ? "border-sky-600/80" : ""}`}
                >
                  <Link href={`/admin/orders/${order.order_id}`} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono font-medium text-white">#{shortId(order.order_id)}</p>
                        <p className="truncate text-sm text-zinc-200">{order.company_name ?? "—"}</p>
                        <p className="truncate text-xs text-zinc-400">{order.contact_name ?? ""}</p>
                        <p className="text-xs text-zinc-500">{formatDate(order.created_at)}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-white">{formatAzn(order.total_amount)}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {order.order_type === "PREORDER" && <Badge tone="blue">ÖN SİFARİŞ</Badge>}
                      <Badge tone={orderStatusTones[order.status]}>{orderStatusLabels[order.status]}</Badge>
                      <Badge tone={paid.tone}>{paid.text}</Badge>
                      <span className="text-xs text-zinc-500">{order.item_count} məhsul</span>
                    </div>
                  </Link>
                  {tel && (
                    <a href={tel} className="btn btn-secondary btn-sm mt-3 w-full">
                      📞 {order.phone}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="table-wrap hidden md:block">
            <table className="table min-w-0 table-fixed">
              <thead>
                <tr>
                  <th className="w-32">Sifariş</th>
                  <th>Müştəri</th>
                  <th className="w-48">Əlaqə</th>
                  <th className="w-44">Status</th>
                  <th className="w-28 text-right">Məbləğ</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((order) => {
                  const paid = paymentBadge(order.payment_status);
                  const tel = order.phone ? phoneHref(order.phone) : null;

                  return (
                    <tr
                      key={order.order_id}
                      className={`hover:bg-zinc-900/60 ${order.payment_status === "CUSTOMER_REPORTED" ? "bg-sky-950/30" : ""}`}
                    >
                      <td className="whitespace-nowrap">
                        <Link
                          href={`/admin/orders/${order.order_id}`}
                          className="font-mono font-medium text-white hover:text-amber-400"
                        >
                          #{shortId(order.order_id)}
                        </Link>
                        <span className="block text-xs text-zinc-500">{formatDate(order.created_at)}</span>
                      </td>
                      <td>
                        <span className="block truncate text-zinc-200" title={order.company_name ?? undefined}>
                          {order.company_name ?? "—"}
                        </span>
                        <span className="block truncate text-xs text-zinc-400">
                          {order.contact_name ?? ""} · {order.item_count} məhsul
                        </span>
                      </td>
                      <td>
                        {tel ? (
                          <a href={tel} className="block truncate text-sm text-amber-400 hover:underline">
                            {order.phone}
                          </a>
                        ) : (
                          <span className="block text-sm text-zinc-600">{order.phone ?? "—"}</span>
                        )}
                        {order.email && (
                          <a
                            href={`mailto:${order.email}`}
                            className="block truncate text-xs text-zinc-400 hover:text-zinc-200"
                            title={order.email}
                          >
                            {order.email}
                          </a>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {order.order_type === "PREORDER" && <Badge tone="blue">ÖN SİFARİŞ</Badge>}
                      <Badge tone={orderStatusTones[order.status]}>{orderStatusLabels[order.status]}</Badge>
                          <Badge tone={paid.tone}>{paid.text}</Badge>
                        </div>
                      </td>
                      <td className="text-right font-semibold whitespace-nowrap text-white">
                        {formatAzn(order.total_amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/orders" params={filters} />
    </>
  );
}
