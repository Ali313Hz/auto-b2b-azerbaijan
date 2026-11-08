import type { Metadata } from "next";
import Link from "next/link";

import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth";

import { logout } from "../(shop)/account/actions";
import ChangePasswordForm from "./ChangePasswordForm";

export const metadata: Metadata = {
  title: "Şifrəni dəyiş",
};

// Reachable with a temporary password. It shows no business data; every
// shop and admin RPC refuses the account until the password is changed.
export default async function ChangePasswordPage() {
  const { user, account } = await requireCurrentSession();

  const mustChange = account?.must_change_password ?? false;
  const expired = account?.temporary_password_expired ?? false;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-white">
            {mustChange ? "Yeni şifrə təyin edin" : "Şifrəni dəyiş"}
          </h1>

          {expired ? (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200"
            >
              Müvəqqəti şifrənin vaxtı bitib. Administratorla əlaqə saxlayın.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-400">
                {mustChange
                  ? "Administrator sizə müvəqqəti şifrə verib. Davam etmək üçün özünüzə yeni şifrə seçin."
                  : "Cari şifrənizi və yeni şifrəni daxil edin."}
              </p>

              <ChangePasswordForm
                email={user.email ?? ""}
                mustChange={mustChange}
                turnstileSiteKey={
                  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined
                }
              />
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
            {!mustChange ? (
              <Link href="/" className="text-sm text-zinc-400 hover:text-white">
                ← Geri
              </Link>
            ) : (
              <span />
            )}

            <form action={logout}>
              <SubmitButton className="btn btn-secondary" pendingText="Çıxılır...">
                Çıxış
              </SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
