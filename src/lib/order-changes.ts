import { formatAzn, orderStatusLabels } from "@/lib/format";
import type { Database } from "@/types/database.types";

type OrderStatus = Database["public"]["Enums"]["order_status"];

// One row of order_change_log in a readable shape (customer and staff).
export type OrderChange = {
  change_id: string;
  change_type: string;
  product_name: string | null;
  sku: string | null;
  quantity_before: number | null;
  quantity_after: number | null;
  price_before: number | null;
  price_after: number | null;
  status_before?: string | null;
  status_after?: string | null;
  actor_name?: string | null;
  created_at: string;
};

export type OrderChangeGroup = {
  change_id: string;
  created_at: string;
  actor_name: string | null;
  total_before: number | null;
  total_after: number | null;
  rows: OrderChange[];
};

// Rows of one save share a change_id; newest save first.
export function groupOrderChanges(rows: OrderChange[]): OrderChangeGroup[] {
  const groups = new Map<string, OrderChangeGroup>();

  for (const row of rows) {
    const group = groups.get(row.change_id) ?? {
      change_id: row.change_id,
      created_at: row.created_at,
      actor_name: row.actor_name ?? null,
      total_before: null,
      total_after: null,
      rows: [],
    };

    if (row.change_type === "ORDER_UPDATED") {
      group.total_before = row.price_before;
      group.total_after = row.price_after;
    } else {
      group.rows.push(row);
    }

    groups.set(row.change_id, group);
  }

  return [...groups.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const name = (row: OrderChange) => row.product_name ?? row.sku ?? "Məhsul";

// Plain sentences, e.g. "Miqdar dəyişdirilib: 2 → 1".
export function describeOrderChange(row: OrderChange, showPrices = true) {
  const lines: string[] = [];

  switch (row.change_type) {
    case "ITEM_ADDED":
      lines.push(
        `Yeni məhsul əlavə edilib: ${row.quantity_after ?? "?"} əd.` +
          (showPrices && row.price_after !== null ? ` × ${formatAzn(row.price_after)}` : "")
      );
      break;
    case "ITEM_REMOVED":
      lines.push(`Məhsul sifarişdən çıxarılıb (${row.quantity_before ?? "?"} əd.)`);
      break;
    case "ITEM_UPDATED":
      if (row.quantity_before !== row.quantity_after) {
        lines.push(`Miqdar dəyişdirilib: ${row.quantity_before} → ${row.quantity_after}`);
      }
      if (showPrices && Number(row.price_before) !== Number(row.price_after)) {
        lines.push(`Qiymət dəyişdirilib: ${formatAzn(row.price_before)} → ${formatAzn(row.price_after)}`);
      }
      break;
    case "STATUS_CHANGED":
      lines.push(
        `Status: ${statusLabel(row.status_before)} → ${statusLabel(row.status_after)}`
      );
      break;
  }

  return { title: row.change_type === "STATUS_CHANGED" ? "Sifarişin statusu" : name(row), lines };
}

function statusLabel(value: string | null | undefined) {
  return value && value in orderStatusLabels
    ? orderStatusLabels[value as OrderStatus]
    : (value ?? "—");
}
