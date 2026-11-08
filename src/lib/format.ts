import type { Database } from "@/types/database.types";

type OrderStatus = Database["public"]["Enums"]["order_status"];
type RevisionStatus = Database["public"]["Enums"]["order_revision_status"];
type PriceGroup = Database["public"]["Enums"]["customer_price_group"];

const aznFormatter = new Intl.NumberFormat("az-AZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAzn(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return `${aznFormatter.format(Number(value))} ₼`;
}

const dateFormatter = new Intl.DateTimeFormat("az-AZ", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Baku",
});

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

// True when a timestamp lies in the past (temporary password expiry).
export function isPast(value: string | null | undefined) {
  return value ? new Date(value).getTime() <= Date.now() : false;
}

export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: "Gözləyir",
  CONFIRMED: "Təsdiqlənib",
  CANCELLED: "Ləğv edilib",
};

export const orderStatusTones: Record<OrderStatus, BadgeTone> = {
  PENDING: "amber",
  CONFIRMED: "green",
  CANCELLED: "red",
};

export const revisionStatusLabels: Record<RevisionStatus, string> = {
  DRAFT: "Qaralama",
  AWAITING_CUSTOMER: "Müştəri cavabı gözlənilir",
  ACCEPTED: "Qəbul edilib",
  REJECTED: "Müştəri qəbul etmədi",
  SUPERSEDED: "Geri çağırılıb",
};

export const revisionStatusTones: Record<RevisionStatus, BadgeTone> = {
  DRAFT: "neutral",
  AWAITING_CUSTOMER: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  SUPERSEDED: "neutral",
};

// Items of a revision as returned (JSON) by the revision RPCs.
export type RevisionItem = {
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export function revisionItems(value: unknown): RevisionItem[] {
  return Array.isArray(value) ? (value as RevisionItem[]) : [];
}

export const priceGroupLabels: Record<PriceGroup, string> = {
  NORMAL: "Normal",
  DEALER: "Diler",
  VIP: "VIP",
};

export const priceGroups = ["NORMAL", "DEALER", "VIP"] as const;

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

// Reads a positive page number from a search param (invalid -> 1).
export function readPage(value: string | string[] | undefined) {
  const page = Number(typeof value === "string" ? value : 1);

  return Number.isInteger(page) && page > 0 && page <= 10000 ? page : 1;
}

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StaffRole = Database["public"]["Enums"]["staff_role"];

export const staffRoles = [
  "OWNER",
  "SALES",
  "PRODUCT_MANAGER",
  "SUPPORT",
  "WAREHOUSE",
] as const satisfies readonly StaffRole[];

export const staffRoleLabels: Record<StaffRole, string> = {
  OWNER: "Sahib (OWNER)",
  SALES: "Satış",
  PRODUCT_MANAGER: "Məhsul meneceri",
  SUPPORT: "Dəstək",
  WAREHOUSE: "Anbar",
};
