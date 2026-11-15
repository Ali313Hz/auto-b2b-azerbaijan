import { requireStaff } from "@/lib/auth";
import {
  orderStatusLabels,
  paymentStatusLabels,
  paymentUnknownLabel,
  shortId,
} from "@/lib/format";
import { formatDay, isValidDate, reportFileName } from "@/lib/report-period";
import { buildXlsx } from "@/lib/xlsx";

// "Excel yüklə": the report of one period as .xlsx (Summary, Orders,
// Products). OWNER / SALES only - checked here and again by every database
// function. Everything is aggregated in the database; at most 50 000 orders
// and 20 000 product rows are read.
export async function GET(request: Request) {
  const { supabase } = await requireStaff("reports");
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return new Response("Tarixlər düzgün deyil.", { status: 400 });
  }

  const range = { p_from: from, p_to: to };
  const [summary, orders, products] = await Promise.all([
    supabase.rpc("get_admin_report_summary", range),
    supabase.rpc("get_admin_report_orders", range),
    supabase.rpc("get_admin_report_products", { ...range, p_limit: 20000 }),
  ]);

  if (summary.error || orders.error || products.error) {
    const denied = [summary.error, orders.error, products.error].some((error) =>
      error?.message.includes("Not authorized")
    );

    return new Response(denied ? "İcazə yoxdur." : "Hesabat hazırlanmadı.", {
      status: denied ? 403 : 500,
    });
  }

  const kpi = summary.data?.[0];
  const dateTime = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baku",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const money = (value: number | string | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;

  const file = buildXlsx([
    {
      name: "Summary",
      columns: [
        { header: "Göstərici", width: 36 },
        { header: "Dəyər", width: 18 },
      ],
      rows: [
        ["Dövr", `${formatDay(from)} – ${formatDay(to)}`],
        ["Sifariş sayı (ləğv edilmişlər daxil deyil)", Number(kpi?.order_count ?? 0)],
        ["Təsdiqlənmiş sifariş", Number(kpi?.confirmed_count ?? 0)],
        ["Satış sayılan sifariş", Number(kpi?.sale_count ?? 0)],
        ["Ümumi satış məbləği (AZN)", money(kpi?.sales_total)],
        ["Orta sifariş məbləği (AZN)", money(kpi?.average_order)],
        ["Ödənişi təsdiqlənmiş məbləğ (AZN)", money(kpi?.paid_total)],
        ["Gözləyən sifariş", Number(kpi?.pending_count ?? 0)],
        ["Gözləyən məbləğ (AZN)", money(kpi?.pending_total)],
        ["Ön sifariş", Number(kpi?.preorder_count ?? 0)],
        ["Ləğv edilmiş (hesablanmır)", Number(kpi?.cancelled_count ?? 0)],
        [],
        ["Satış = təsdiqlənmiş və ya ödənişi təsdiqlənmiş sifariş. Qiymətlər sifariş anındakı qiymətlərdir. Bakı vaxtı."],
      ],
    },
    {
      name: "Orders",
      columns: [
        { header: "Sifariş №", width: 12 },
        { header: "Tarix", width: 18 },
        { header: "Şirkət", width: 28 },
        { header: "Əlaqə şəxsi", width: 22 },
        { header: "Növ", width: 12 },
        { header: "Status", width: 14 },
        { header: "Ödəniş", width: 22 },
        { header: "Məhsul sayı", width: 12, format: "int" },
        { header: "Məbləğ (AZN)", width: 14, format: "money" },
        { header: "Satış sayılır", width: 13 },
      ],
      rows: (orders.data ?? []).map((row) => [
        `#${shortId(row.order_id)}`,
        dateTime.format(new Date(row.created_at)).replace(",", ""),
        row.company_name ?? "",
        row.contact_name ?? "",
        row.order_type === "PREORDER" ? "Ön sifariş" : "Normal",
        orderStatusLabels[row.status],
        row.payment_status ? paymentStatusLabels[row.payment_status] : paymentUnknownLabel,
        Number(row.item_count),
        money(row.total_amount),
        row.is_sale ? "Bəli" : "Xeyr",
      ]),
    },
    {
      name: "Products",
      columns: [
        { header: "SKU", width: 18 },
        { header: "Məhsul", width: 40 },
        { header: "Satılan miqdar", width: 15, format: "int" },
        { header: "Sifariş sayı", width: 12, format: "int" },
        { header: "Satış məbləği (AZN)", width: 18, format: "money" },
      ],
      rows: (products.data ?? []).map((row) => [
        row.sku,
        row.name ?? "",
        Number(row.quantity),
        Number(row.order_count),
        money(row.sales_total),
      ]),
    },
  ]);

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileName(from, to)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
