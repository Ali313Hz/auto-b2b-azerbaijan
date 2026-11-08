import type { Metadata } from "next";
import Link from "next/link";

import SubmitButton from "@/components/SubmitButton";
import { Badge, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { priceGroupLabels } from "@/lib/format";
import { SHOW_MFA_SETTINGS } from "@/lib/mfa";

import { logout } from "./actions";

export const metadata: Metadata = {
  title: "Hesab",
};

export default async function AccountPage() {
  const { user, customer } = await requireCustomer();

  const rows = [
    ["Şirkət", customer.company_name ?? "—"],
    ["Əlaqə şəxsi", customer.contact_name ?? "—"],
    ["Telefon", customer.phone ?? "—"],
    ["E-poçt", user.email ?? "—"],
  ];

  return (
    <>
      <PageHeader title="Hesab" />

      <div className="card max-w-2xl p-5 sm:p-6">
        <dl className="divide-y divide-zinc-800">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[160px_1fr]"
            >
              <dt className="text-sm text-zinc-400">{label}</dt>
              <dd className="break-words text-zinc-100">{value}</dd>
            </div>
          ))}

          <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[160px_1fr]">
            <dt className="text-sm text-zinc-400">Qiymət qrupu</dt>
            <dd>
              <Badge tone="blue">
                {priceGroupLabels[customer.price_group]}
              </Badge>
            </dd>
          </div>

          <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[160px_1fr]">
            <dt className="text-sm text-zinc-400">Status</dt>
            <dd>
              <Badge tone="green">Aktiv</Badge>
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-zinc-500">
          Məlumatları və ya qiymət qrupunu dəyişmək üçün administratorla
          əlaqə saxlayın.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/change-password" className="btn btn-secondary">
            Şifrəni dəyiş
          </Link>

          {SHOW_MFA_SETTINGS && (
            <Link href="/security" className="btn btn-secondary">
              İki mərhələli təsdiq
            </Link>
          )}

          <form action={logout}>
            <SubmitButton className="btn btn-secondary" pendingText="Çıxılır...">
              Hesabdan çıx
            </SubmitButton>
          </form>
        </div>
      </div>
    </>
  );
}
