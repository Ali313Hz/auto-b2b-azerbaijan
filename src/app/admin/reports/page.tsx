import type { Metadata } from "next";
import Link from "next/link";

import Pagination, { pageHref } from "@/components/Pagination";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatAzn, formatDate, readPage } from "@/lib/format";
import {
  bakuToday,
  chartRange,
  monthLabel,
  periodLabel,
  recentMonths,
  reportPresets,
  resolvePeriod,
  shortMonthNames,
} from "@/lib/report-period";

import MonthlyChart from "./MonthlyChart";

export const metadata: Metadata = {
  title: "Hesabatlar",
};

const UNSOLD_PAGE_SIZE = 20;
const SALES_COLOR = "#d97706";
const PAID_COLOR = "#0284c7";

// OWNER and SALES only (also checked by every database function).
export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const params = await searchParams;
  const { supabase } = await requireStaff("reports");
  const today = bakuToday();
  const period = resolvePeriod(params, today);
  const chart = chartRange(period);
  const unsoldPage = readPage(params.page);
  const range = { p_from: period.from, p_to: period.to };

  const [summary, monthly, products, customers, unsold] = await Promise.all([
    supabase.rpc("get_admin_report_summary", range),
    supabase.rpc("get_admin_report_monthly", { p_from: chart.from, p_to: chart.to }),
    supabase.rpc("get_admin_report_products", { ...range, p_limit: 10 }),
    supabase.rpc("get_admin_report_customers", { ...range, p_limit: 10 }),
    supabase.rpc("get_admin_report_unsold_products", {
      ...range,
      p_page: unsoldPage,
      p_page_size: UNSOLD_PAGE_SIZE,
    }),
  ]);

  const failed = summary.error || monthly.error || products.error || customers.error || unsold.error;

  // Links keep the chosen period.
  const periodParams: Record<string, string | undefined> = {
    period: period.preset,
    month: period.month,
    from: period.preset === "custom" ? period.from : undefined,
    to: period.preset === "custom" ? period.to : undefined,
  };
  const exportHref = `/admin/reports/export?from=${period.from}&to=${period.to}`;
  const kpi = summary.data?.[0];
  const months = monthly.data ?? [];
  const unsoldRows = unsold.data ?? [];
  const unsoldTotal = Number(unsoldRows[0]?.total_count ?? 0);

  return (
    <>
      <PageHeader
        title="Hesabatlar"
        description={periodLabel(period)}
        actions={
          <a href={exportHref} className="btn btn-primary" download>
            Excel yüklə
          </a>
        }
      />

      {period.invalid && (
        <Alert tone="amber">Tarixlər düzgün deyil. “Bu ay” göstərilir.</Alert>
      )}

      <section aria-label="Dövr" className="card mb-6 space-y-3 p-4">
        <nav aria-label="Hazır dövrlər" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {reportPresets.map((preset) => (
            <Link
              key={preset.value}
              href={pageHref("/admin/reports", { period: preset.value }, 1)}
              className={`btn btn-sm whitespace-nowrap ${
                period.preset === preset.value ? "btn-primary" : "btn-secondary"
              }`}
            >
              {preset.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-end gap-4">
          <form action="/admin/reports" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="period" value="month" />
            <label className="min-w-0">
              <span className="label">Keçmiş ay</span>
              <select name="month" defaultValue={period.month ?? ""} className="input">
                <option value="" disabled>
                  Ay seçin
                </option>
                {recentMonths(36, today).map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Göstər
            </button>
          </form>

          <form action="/admin/reports" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="period" value="custom" />
            <label>
              <span className="label">Başlanğıc</span>
              <input type="date" name="from" defaultValue={period.from} max={today} required className="input" />
            </label>
            <label>
              <span className="label">Son</span>
              <input type="date" name="to" defaultValue={period.to} max={today} required className="input" />
            </label>
            <button type="submit" className="btn btn-secondary">
              Göstər
            </button>
          </form>
        </div>
      </section>

      {failed ? (
        <Alert>Hesabat yüklənmədi. Səhifəni yeniləyin.</Alert>
      ) : (
        <div className="space-y-8">
          <section aria-label="Əsas göstəricilər" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Sifariş sayı" value={String(kpi?.order_count ?? 0)} hint="Ləğv edilmişlər daxil deyil" />
            <Kpi label="Təsdiqlənmiş sifariş" value={String(kpi?.confirmed_count ?? 0)} />
            <Kpi
              label="Ümumi satış məbləği"
              value={formatAzn(kpi?.sales_total ?? 0)}
              hint="Təsdiqlənmiş və ya ödənişi təsdiqlənmiş sifarişlər"
              strong
            />
            <Kpi label="Orta sifariş məbləği" value={formatAzn(kpi?.average_order ?? 0)} />
            <Kpi label="Ödənişi təsdiqlənmiş məbləğ" value={formatAzn(kpi?.paid_total ?? 0)} />
          </section>

          <p className="-mt-5 text-xs text-zinc-500">
            Gözləyən: {kpi?.pending_count ?? 0} sifariş · {formatAzn(kpi?.pending_total ?? 0)} (hələ satış sayılmır) ·
            Ön sifariş: {kpi?.preorder_count ?? 0} · Ləğv edilmiş: {kpi?.cancelled_count ?? 0} (hesablanmır)
          </p>

          <section aria-label="Aylıq qrafiklər" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <MonthlyChart
              title="Aylıq satış məbləği"
              months={months.map((row) => row.month)}
              series={[
                { label: "Satış", color: SALES_COLOR, values: months.map((row) => Number(row.sales_total)) },
                { label: "Ödənişi təsdiqlənmiş", color: PAID_COLOR, values: months.map((row) => Number(row.paid_total)) },
              ]}
              format={(value) => formatAzn(value)}
            />
            <MonthlyChart
              title="Aylıq sifariş sayı"
              months={months.map((row) => row.month)}
              series={[{ label: "Sifariş", color: SALES_COLOR, values: months.map((row) => Number(row.order_count)) }]}
              format={(value) => `${value} sifariş`}
            />
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-300">Aylar üzrə cədvəl</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-zinc-500">
                  <tr>
                    <th className="py-2 pr-4">Ay</th>
                    <th className="py-2 pr-4 text-right">Sifariş</th>
                    <th className="py-2 pr-4 text-right">Satış</th>
                    <th className="py-2 text-right">Ödənişi təsdiqlənmiş</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {months.map((row) => {
                    const [y, m] = row.month.split("-").map(Number);
                    return (
                      <tr key={row.month}>
                        <td className="py-2 pr-4 text-zinc-300">{`${shortMonthNames[m - 1]} ${y}`}</td>
                        <td className="py-2 pr-4 text-right">{row.order_count}</td>
                        <td className="py-2 pr-4 text-right">{formatAzn(row.sales_total)}</td>
                        <td className="py-2 text-right">{formatAzn(row.paid_total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="card min-w-0 p-4">
              <h2 className="font-semibold text-white">Ən çox satılan məhsullar</h2>
              {(products.data ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">Bu dövrdə satış yoxdur.</p>
              ) : (
                <ol className="mt-3 divide-y divide-zinc-800">
                  {(products.data ?? []).map((row, index) => (
                    <li key={row.product_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="mr-2 text-zinc-500">{index + 1}.</span>
                        <Link href={`/admin/products/${row.product_id}`} className="break-words text-white hover:text-amber-400">
                          {row.name ?? row.sku}
                        </Link>
                        <span className="block font-mono text-xs text-zinc-500">
                          {row.sku} · {row.quantity} əd. · {row.order_count} sifariş
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-zinc-100">{formatAzn(row.sales_total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card min-w-0 p-4">
              <h2 className="font-semibold text-white">Ən çox alış edən müştərilər</h2>
              {(customers.data ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">Bu dövrdə satış yoxdur.</p>
              ) : (
                <ol className="mt-3 divide-y divide-zinc-800">
                  {(customers.data ?? []).map((row, index) => (
                    <li key={row.customer_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="mr-2 text-zinc-500">{index + 1}.</span>
                        <Link href={`/admin/customers/${row.customer_id}`} className="break-words text-white hover:text-amber-400">
                          {row.company_name ?? row.contact_name ?? "—"}
                        </Link>
                        <span className="block text-xs text-zinc-500">{row.order_count} sifariş</span>
                      </span>
                      <span className="shrink-0 font-semibold text-zinc-100">{formatAzn(row.sales_total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className="min-w-0">
            <h2 className="mb-1 text-lg font-semibold text-white">Satışı olmayan məhsullar</h2>
            <p className="mb-3 text-sm text-zinc-400">
              Satışda olan, amma bu dövrdə heç satılmayan məhsullar ({unsoldTotal}).
            </p>
            {unsoldRows.length === 0 ? (
              <EmptyState title="Bütün aktiv məhsullar bu dövrdə satılıb" />
            ) : (
              <ul className="card divide-y divide-zinc-800">
                {unsoldRows.map((row) => (
                  <li key={row.product_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <Link href={`/admin/products/${row.product_id}`} className="break-words text-white hover:text-amber-400">
                        {row.name}
                      </Link>
                      <span className="block font-mono text-xs text-zinc-500">
                        {row.sku} · {row.category_name ?? "Kateqoriyasız"}
                      </span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      Stok: {row.stock} · Əlavə edilib: {formatDate(row.created_at).slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              page={unsoldPage}
              pageSize={UNSOLD_PAGE_SIZE}
              total={unsoldTotal}
              basePath="/admin/reports"
              params={periodParams}
            />
          </section>

          <p className="text-xs text-zinc-500">
            Məbləğlər sifariş anında saxlanmış qiymətlərlə hesablanır. Satış = təsdiqlənmiş və ya ödənişi
            təsdiqlənmiş sifariş (ön sifarişlər də). Ləğv edilmiş sifarişlər heç bir rəqəmə daxil deyil.
            Tarixlər Bakı vaxtı ilə.
          </p>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`card min-w-0 p-4 ${strong ? "border-amber-700/60" : ""}`}>
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold break-words ${strong ? "text-amber-400" : "text-white"}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
