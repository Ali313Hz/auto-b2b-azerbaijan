import type { Metadata } from "next";
import { redirect } from "next/navigation";

import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { logout } from "../(shop)/account/actions";
import MfaChallenge from "./MfaChallenge";
import MfaEnroll from "./MfaEnroll";

export const metadata: Metadata = {
  title: "İki mərhələli təsdiq",
};

// Second login step. Users without a verified authenticator must enroll
// one here; everyone else enters a 6-digit TOTP code.
export default async function MfaPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal?.currentLevel === "aal2") {
    redirect("/");
  }

  const { data: factors, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    redirect("/login?error=session");
  }

  const verified = (factors?.totp ?? []).map((factor) => ({
    id: factor.id,
    name: factor.friendly_name ?? "Autentifikator",
  }));

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-6 sm:p-8">
          {verified.length > 0 ? (
            <MfaChallenge factors={verified} />
          ) : (
            <MfaEnroll />
          )}
        </div>

        <form action={logout} className="mt-4 flex justify-center">
          <SubmitButton className="btn btn-secondary btn-sm" pendingText="Çıxılır...">
            Başqa hesabla daxil ol
          </SubmitButton>
        </form>
      </div>
    </main>
  );
}
