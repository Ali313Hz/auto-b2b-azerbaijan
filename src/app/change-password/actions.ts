"use server";

import { createClient } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/password";

export type ChangePasswordResult = { ok: boolean; message: string };

// The browser has just signed in again with the current (or temporary)
// password, so the session's password login must be this recent.
const MAX_LOGIN_AGE_SECONDS = 10 * 60;

const EXPIRED_MESSAGE =
  "Müvəqqəti şifrənin vaxtı bitib. Administratorla əlaqə saxlayın.";

// Changes the signed-in user's own password. Never logs or returns the
// password; Supabase Auth stores only its bcrypt hash.
export async function changeOwnPassword(
  newPassword: string,
  confirmPassword: string
): Promise<ChangePasswordResult> {
  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { ok: false, message: "Şifrə yanlışdır." };
  }

  const problem = passwordProblem(newPassword);

  if (problem) {
    return { ok: false, message: problem };
  }

  if (newPassword !== confirmPassword) {
    return { ok: false, message: "Yeni şifrələr eyni deyil." };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub || !claims.session_id) {
    return { ok: false, message: "Sessiya bitib. Yenidən daxil olun." };
  }

  const now = Math.floor(Date.now() / 1000);
  const passwordLogin = (claims.amr ?? []).find(
    (entry) => typeof entry === "object" && entry.method === "password"
  );
  const loginAt =
    passwordLogin && typeof passwordLogin === "object" ? passwordLogin.timestamp : 0;

  if (!loginAt || now - loginAt > MAX_LOGIN_AGE_SECONDS) {
    return { ok: false, message: "Cari şifrəni yenidən daxil edin." };
  }

  const { data: accountRows, error: accountError } = await supabase.rpc(
    "get_my_account_state"
  );
  const account = accountRows?.[0];

  if (accountError || !account || !account.session_current) {
    return { ok: false, message: "Sessiya bitib. Yenidən daxil olun." };
  }

  if (!account.active) {
    return {
      ok: false,
      message: "Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.",
    };
  }

  if (account.temporary_password_expired) {
    return { ok: false, message: EXPIRED_MESSAGE };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    if (updateError.code === "same_password") {
      return { ok: false, message: "Yeni şifrə köhnə şifrədən fərqli olmalıdır." };
    }

    if (updateError.code === "weak_password") {
      return {
        ok: false,
        message: "Şifrə çox zəifdir. Daha uzun və fərqli şifrə seçin.",
      };
    }

    return { ok: false, message: "Şifrə dəyişdirilmədi. Yenidən cəhd edin." };
  }

  // Clears the temporary-password flag and makes every other session of
  // this user stop working in the database. Users cannot call this RPC.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error: completeError } = await createAdminClient().rpc(
    "complete_password_change",
    { p_user_id: claims.sub, p_session_id: claims.session_id }
  );

  if (completeError) {
    console.error("complete_password_change failed");

    return { ok: false, message: "Şifrə dəyişdirilmədi. Yenidən cəhd edin." };
  }

  // Also end the other sessions in Supabase Auth (supported API).
  await supabase.auth.signOut({ scope: "others" });

  return { ok: true, message: "Şifrə dəyişdirildi." };
}
