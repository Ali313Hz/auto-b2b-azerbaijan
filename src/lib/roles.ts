import type { Database } from "@/types/database.types";

export type StaffRole = Database["public"]["Enums"]["staff_role"];

// Mirrors the role lists in the database RPCs (migration
// staff_role_access). The database is the authority; these only decide
// which pages, links and buttons are shown.
export const access = {
  dashboard: ["OWNER", "SALES", "PRODUCT_MANAGER", "SUPPORT", "WAREHOUSE"],
  customersView: ["OWNER", "SALES", "SUPPORT"],
  customersEdit: ["OWNER", "SALES"],
  ordersView: ["OWNER", "SALES", "WAREHOUSE", "SUPPORT"],
  ordersProcess: ["OWNER", "SALES", "WAREHOUSE"],
  productsView: ["OWNER", "PRODUCT_MANAGER", "WAREHOUSE"],
  productsEdit: ["OWNER", "PRODUCT_MANAGER"],
  stockEdit: ["OWNER", "PRODUCT_MANAGER", "WAREHOUSE"],
  categories: ["OWNER", "PRODUCT_MANAGER"],
  owner: ["OWNER"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Access = keyof typeof access;

export function can(role: StaffRole | null | undefined, area: Access) {
  return !!role && (access[area] as readonly StaffRole[]).includes(role);
}
