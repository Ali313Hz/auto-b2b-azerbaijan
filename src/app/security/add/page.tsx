import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/ui";
import { requireMfaUser } from "@/lib/auth";

import MfaEnroll from "../../mfa/MfaEnroll";

export const metadata: Metadata = {
  title: "Ehtiyat cihaz",
};

export default async function AddFactorPage() {
  const { supabase } = await requireMfaUser();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasFactor = (factors?.totp ?? []).length > 0;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-6 sm:p-8">
          <MfaEnroll mode={hasFactor ? "backup" : "optional"} />
        </div>

        <p className="mt-4 text-center">
          <Link href="/security" className="text-sm text-zinc-400 hover:text-zinc-200">
            Ləğv et
          </Link>
        </p>
      </div>
    </main>
  );
}
