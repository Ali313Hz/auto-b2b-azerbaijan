import type { Metadata } from "next";
import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, Logo, PageHeader } from "@/components/ui";
import { requireMfaUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

import { removeFactor } from "./actions";

export const metadata: Metadata = {
  title: "Təhlükəsizlik",
};

export default async function SecurityPage({
  searchParams,
}: PageProps<"/security">) {
  const [{ supabase, staff }, params] = await Promise.all([
    requireMfaUser(),
    searchParams,
  ]);

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp ?? [];
  const backHref = staff?.active && staff.role === "OWNER" ? "/admin" : "/account";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Logo />
        <Link href={backHref} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Geri
        </Link>
      </div>

      <PageHeader
        title="İki mərhələli təsdiq"
        description="Hesabınıza giriş üçün şifrədən sonra autentifikator kodu tələb olunur."
      />

      {params.notice === "added" && <Alert tone="green">Ehtiyat cihaz əlavə edildi.</Alert>}

      <section className="card p-5 sm:p-6">
        <h2 className="font-semibold text-white">Qoşulmuş cihazlar</h2>

        <ul className="mt-4 divide-y divide-zinc-800">
          {verified.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-zinc-100">{factor.friendly_name ?? "Autentifikator"}</p>
                <p className="text-xs text-zinc-500">Əlavə edilib: {formatDate(factor.created_at)}</p>
              </div>

              {verified.length > 1 ? (
                <ActionForm
                  action={removeFactor}
                  confirmMessage="Bu cihaz silinsin? Onunla artıq daxil olmaq mümkün olmayacaq."
                >
                  <input type="hidden" name="factorId" value={factor.id} />
                  <SubmitButton className="btn btn-danger btn-sm" pendingText="Silinir...">
                    Sil
                  </SubmitButton>
                </ActionForm>
              ) : (
                <Badge tone="green">Əsas cihaz</Badge>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-zinc-800 pt-5">
          <Link href="/security/add" className="btn btn-primary">
            + Ehtiyat cihaz əlavə et
          </Link>
          <p className="mt-3 text-xs text-zinc-500">
            Tövsiyə: ikinci cihaz (məsələn, planşet) əlavə edin. Bütün cihazlar
            itərsə, müştərilər administratora, administrator isə Supabase
            idarəetmə panelinə müraciət etməlidir.
          </p>
        </div>
      </section>
    </main>
  );
}
