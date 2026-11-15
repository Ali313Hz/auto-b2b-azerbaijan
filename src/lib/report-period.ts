// Report periods, in Baku time (the database uses the same zone).

export const reportPresets = [
  { value: "this_month", label: "Bu ay" },
  { value: "last_month", label: "Keçən ay" },
  { value: "3m", label: "Son 3 ay" },
  { value: "6m", label: "Son 6 ay" },
  { value: "year", label: "Bu il" },
] as const;

export type ReportPreset = (typeof reportPresets)[number]["value"] | "month" | "custom";

export type ReportPeriod = {
  preset: ReportPreset;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  month?: string; // YYYY-MM when one month was picked
  invalid?: boolean;
};

const monthNames = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "İyun",
  "İyul",
  "Avqust",
  "Sentyabr",
  "Oktyabr",
  "Noyabr",
  "Dekabr",
];

export const shortMonthNames = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;

export function bakuToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baku",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function iso(year: number, month: number, day: number) {
  // month is 1-based; Date.UTC normalises overflow (e.g. month 0, day 0).
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;

  const [y, m, d] = value.split("-").map(Number);

  return iso(y, m, d) === value && y >= 2000 && y <= 2100;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);

  return `${monthNames[m - 1]} ${y}`;
}

// Last N months (newest first) for the "pick a month" list.
export function recentMonths(count: number, today = bakuToday()) {
  const [y, m] = today.split("-").map(Number);

  return Array.from({ length: count }, (_, i) => iso(y, m - i, 1).slice(0, 7));
}

function daysBetween(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function resolvePeriod(
  params: Record<string, string | string[] | undefined>,
  today = bakuToday()
): ReportPeriod {
  const [y, m] = today.split("-").map(Number);
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const preset = pick("period");

  if (preset === "month") {
    const month = pick("month");

    if (month && monthPattern.test(month) && isValidDate(`${month}-01`) && `${month}-01` <= today) {
      const [my, mm] = month.split("-").map(Number);
      return { preset: "month", month, from: `${month}-01`, to: iso(my, mm + 1, 0) };
    }
  }

  if (preset === "custom") {
    const from = pick("from");
    const to = pick("to");

    if (isValidDate(from) && isValidDate(to) && from <= to && daysBetween(from, to) <= 3650) {
      return { preset: "custom", from, to };
    }

    return { preset: "this_month", from: iso(y, m, 1), to: today, invalid: true };
  }

  switch (preset) {
    case "last_month":
      return { preset, from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "3m":
      return { preset, from: iso(y, m - 2, 1), to: today };
    case "6m":
      return { preset, from: iso(y, m - 5, 1), to: today };
    case "year":
      return { preset, from: iso(y, 1, 1), to: today };
    default:
      return { preset: "this_month", from: iso(y, m, 1), to: today };
  }
}

// The monthly chart shows at least six months, ending with the period.
export function chartRange(period: ReportPeriod) {
  const [ty, tm] = period.to.split("-").map(Number);
  const sixBack = iso(ty, tm - 5, 1);

  return { from: period.from < sixBack ? period.from : sixBack, to: period.to };
}

export function periodLabel(period: ReportPeriod) {
  const preset = reportPresets.find((item) => item.value === period.preset);

  if (period.month) return monthLabel(period.month);

  const range = `${formatDay(period.from)} – ${formatDay(period.to)}`;

  return preset ? `${preset.label} (${range})` : range;
}

export function formatDay(value: string) {
  const [y, m, d] = value.split("-");

  return `${d}.${m}.${y}`;
}

// dostlar-auto-report-2026-11.xlsx for a whole month, otherwise the dates.
export function reportFileName(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const wholeMonth = fd === 1 && to === iso(fy, fm + 1, 0);

  return wholeMonth || (fd === 1 && from.slice(0, 7) === to.slice(0, 7))
    ? `dostlar-auto-report-${from.slice(0, 7)}.xlsx`
    : `dostlar-auto-report-${from}_${to}.xlsx`;
}
