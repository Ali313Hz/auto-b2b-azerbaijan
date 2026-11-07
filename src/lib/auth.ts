import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Deduplicated per request so layouts and pages share one auth lookup.
//
// Profiles are only read after the session reached aal2 (password + TOTP).
// The database enforces the same rule; this keeps the UI from rendering
// pages whose data calls would be rejected.
export const getSession = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, mfaVerified: false, staff: null, customer: null };
  }

  // getUser() validated this session's access token with the Auth server,
  // so the aal claim decoded from the same token can be trusted.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal?.currentLevel !== "aal2") {
    return { supabase, user, mfaVerified: false, staff: null, customer: null };
  }

  const [{ data: staff }, { data: customer }] = await Promise.all([
    supabase
      .from("staff_profiles")
      .select("full_name, role, active")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("customer_profiles")
      .select("company_name, contact_name, phone, price_group, active, archived_at")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return { supabase, user, mfaVerified: true, staff, customer };
});

export async function requireOwner() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (!session.mfaVerified) {
    redirect("/mfa");
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

  if (!session.mfaVerified) {
    redirect("/mfa");
  }

  if (session.staff?.active && session.staff.role === "OWNER") {
    redirect("/admin");
  }

  const { customer } = session;

  if (!customer) {
    redirect("/");
  }

  if (!customer.active || customer.archived_at) {
    redirect("/login?error=inactive");
  }

  return { ...session, user: session.user, customer };
}

// Any signed-in user who completed MFA (used by the security settings page).
export async function requireMfaUser() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (!session.mfaVerified) {
    redirect("/mfa");
  }

  return { ...session, user: session.user };
}
