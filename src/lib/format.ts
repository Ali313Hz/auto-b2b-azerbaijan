import type { Database } from "@/types/database.types";

type OrderStatus = Database["public"]["Enums"]["order_status"];
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

export const priceGroupLabels: Record<PriceGroup, string> = {
  NORMAL: "Normal",
  DEALER: "Diler",
  VIP: "VIP",
};

export const priceGroups = ["NORMAL", "DEALER", "VIP"] as const;

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";
