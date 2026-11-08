import "server-only";

import { redirect } from "next/navigation";

import type { PasswordResetResult } from "@/components/PasswordResetForm";
import { generateTemporaryPassword, passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";

export type UserClient = Awaited<ReturnType<typeof createClient>>;

export async function getAuthedClient() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

// Service-role operations bypass RLS, so the database first confirms the
// caller is an active OWNER (current session, no pending temporary
// password) before the secret key is used. Any error or doubt: no access.
export async function getOwnerClient() {
  const { supabase, user } = await getAuthedClient();

  const { data: isOwner, error } = await supabase.rpc("current_user_is_owner");

  if (error || isOwner !== true) {
    return null;
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");

  return { supabase, user, admin: createAdminClient() };
}

export type OwnerClient = NonNullable<Awaited<ReturnType<typeof getOwnerClient>>>;

export type SecurityEvent =
  | "customer_created"
  | "customer_email_changed"
  | "customer_activated"
  | "customer_deactivated"
  | "customer_archived"
  | "customer_restored"
  | "customer_mfa_reset"
  | "customer_deleted"
  | "staff_email_changed";

// Only the action name and the target id are recorded, never credentials.
export async function recordEvent(
  supabase: UserClient,
  action: SecurityEvent,
  targetId: string
) {
  const { error } = await supabase.rpc("record_admin_security_event", {
    p_action: action,
    p_target_id: targetId,
  });

  if (error) {
    console.error("Audit event not recorded", action);
  }
}

// Reads "mode" (generate | manual) and "password" from the reset form.
export function temporaryPasswordFrom(formData: FormData) {
  const mode = formData.get("mode");

  if (mode === "generate") {
    return { password: generateTemporaryPassword(), generated: true, problem: null };
  }

  const password = formData.get("password");

  if (mode !== "manual" || typeof password !== "string") {
    return { password: "", generated: false, problem: "Şifrə növünü seçin." };
  }

  return { password, generated: false, problem: passwordProblem(password) };
}

// OWNER password reset for a customer or staff account:
// 1. the database checks the OWNER, the account type and the target, marks
//    the account (must change within 24 h), ends old sessions and writes
//    the audit row;
// 2. Supabase Auth stores the new password (bcrypt).
// The temporary password is returned once to the OWNER and nowhere else.
export async function resetAccountPassword(
  owner: OwnerClient,
  userId: string,
  accountType: "customer" | "staff",
  formData: FormData
): Promise<PasswordResetResult> {
  const { password, problem } = temporaryPasswordFrom(formData);

  if (problem) {
    return { ok: false, message: problem };
  }

  if (userId === owner.user.id) {
    return {
      ok: false,
      message: "Öz şifrənizi “Şifrəni dəyiş” səhifəsində dəyişin.",
    };
  }

  const { error: markError } = await owner.supabase.rpc(
    "mark_admin_password_reset",
    { p_user_id: userId, p_account_type: accountType }
  );

  if (markError) {
    return {
      ok: false,
      message:
        markError.message === "Customer not found"
          ? "Müştəri tapılmadı."
          : markError.message === "Staff member not found"
            ? "İşçi tapılmadı."
            : "Şifrə sıfırlanmadı.",
    };
  }

  const { error: authError } = await owner.admin.auth.admin.updateUserById(
    userId,
    { password }
  );

  if (authError) {
    // The account is already locked to "must change"; old sessions are cut
    // off. Retrying sets a new temporary password.
    return {
      ok: false,
      message:
        authError.code === "weak_password"
          ? "Şifrə Supabase şifrə qaydasına uyğun deyil. Başqa şifrə seçin."
          : "Şifrə sıfırlanmadı. Yenidən cəhd edin.",
    };
  }

  return {
    ok: true,
    message: "Şifrə sıfırlandı.",
    temporaryPassword: password,
  };
}
