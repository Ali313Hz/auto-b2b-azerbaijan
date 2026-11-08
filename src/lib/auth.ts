import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { MFA_REQUIRED } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";

// Deduplicated per request so layouts and pages share one auth lookup.
//
// mfaVerified means the session meets the MFA rule: it reached aal2
// (password + TOTP), or MFA is optional and the user has no verified
// authenticator. The database enforces the same rule
// (private.mfa_satisfied); this keeps the UI from rendering pages whose data
// calls would be rejected.
export const getSession = cache(async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, mfaVerified: false, staff: null, customer: null, account: null };
  }

  // getUser() validated this session's access token with the Auth server,
  // so the aal claim decoded from the same token can be trusted, and its
  // factor list is current.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const hasVerifiedFactor = (user.factors ?? []).some(
    (factor) => factor.status === "verified"
  );
  const mfaVerified =
    aal?.currentLevel === "aal2" || (!MFA_REQUIRED && !hasVerifiedFactor);

  if (!mfaVerified) {
    return { supabase, user, mfaVerified: false, staff: null, customer: null, account: null };
  }

  const [{ data: staff }, { data: customer }, { data: accountRows }] = await Promise.all([
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
    // Same checks the database applies to every RPC: is this session still
    // valid after the last password change, and is a temporary password
    // waiting to be replaced?
    supabase.rpc("get_my_account_state"),
  ]);

  return {
    supabase,
    user,
    mfaVerified: true,
    staff,
    customer,
    account: accountRows?.[0] ?? null,
  };
});

type Session = Awaited<ReturnType<typeof getSession>>;

// Sends sessions from before a password change back to login, and users
// with a temporary password to the change-password page. The database
// refuses these sessions anyway; this only keeps the UI consistent.
function enforceAccountState(session: Session) {
  if (session.account && !session.account.session_current) {
    redirect("/login?error=session");
  }

  if (session.account?.must_change_password) {
    redirect("/change-password");
  }
}

export async function requireOwner() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (!session.mfaVerified) {
    redirect("/mfa");
  }

  enforceAccountState(session);

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

  enforceAccountState(session);

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

// Any signed-in user whose session meets the MFA rule (security settings).
export async function requireMfaUser() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (!session.mfaVerified) {
    redirect("/mfa");
  }

  enforceAccountState(session);

  return { ...session, user: session.user };
}

// Signed in with a still-valid session; a pending temporary password is
// allowed (change-password page).
export async function requireCurrentSession() {
  const session = await getSession();

  if (!session.user) {
    redirect("/login");
  }

  if (!session.mfaVerified) {
    redirect("/mfa");
  }

  if (session.account && !session.account.session_current) {
    redirect("/login?error=session");
  }

  return { ...session, user: session.user };
}
