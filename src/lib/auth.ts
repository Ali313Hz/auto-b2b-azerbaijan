import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Deduplicated per request so layouts and pages share one auth lookup.
export const getSession = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, staff: null, customer: null };
  }

  const [{ data: staff }, { data: customer }] = await Promise.all([
    supabase
      .from("staff_profiles")
      .select("full_name, role, active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("customer_profiles")
      .select("company_name, contact_name, phone, price_group, active")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return { supabase, user, staff, customer };
});

export async function requireOwner() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  const { staff } = session;

  if (!staff || !staff.active || staff.role !== "OWNER") {
    redirect("/");
  }

  return { ...session, user: session.user, staff };
}

export async function requireCustomer() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (session.staff?.active && session.staff.role === "OWNER") {
    redirect("/admin");
  }

  const { customer } = session;

  if (!customer) {
    redirect("/");
  }

  if (!customer.active) {
    redirect("/login?error=inactive");
  }

  return { ...session, user: session.user, customer };
}
