import type { Metadata } from "next";
import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { priceGroupLabels, priceGroups } from "@/lib/format";

import { createCustomer } from "../actions";

export const metadata: Metadata = {
  title: "Yeni müştəri",
};

export default async function NewCustomerPage() {
  await requireOwner();

  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Müştərilər
      </Link>

      <PageHeader
        title="Yeni müştəri"
        description="Müştəri bu e-poçt və şifrə ilə daxil olacaq. Şifrəni müştəriyə təhlükəsiz kanalla çatdırın."
      />

      <ActionForm
        action={createCustomer}
        className="card max-w-3xl space-y-5 p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Şirkət adı *" htmlFor="companyName">
            <input id="companyName" name="companyName" required maxLength={200} className="input" />
          </Field>

          <Field label="Əlaqə şəxsi *" htmlFor="contactName">
            <input id="contactName" name="contactName" required maxLength={200} className="input" />
          </Field>

          <Field label="Telefon" htmlFor="phone">
            <input id="phone" type="tel" name="phone" maxLength={40} className="input" />
          </Field>

          <Field label="E-poçt *" htmlFor="email">
            <input id="email" type="email" name="email" required autoComplete="off" className="input" />
          </Field>

          <Field label="Müvəqqəti şifrə *" htmlFor="password" hint="Ən azı 8 simvol.">
            <input
              id="password"
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
            />
          </Field>

          <Field label="Qiymət qrupu" htmlFor="priceGroup">
            <select id="priceGroup" name="priceGroup" defaultValue="NORMAL" className="input">
              {priceGroups.map((group) => (
                <option key={group} value={group}>
                  {priceGroupLabels[group]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status" htmlFor="active">
            <select id="active" name="active" defaultValue="true" className="input">
              <option value="true">Aktiv</option>
              <option value="false">Deaktiv</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end border-t border-zinc-800 pt-5">
          <SubmitButton pendingText="Yaradılır...">Müştəri yarat</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
