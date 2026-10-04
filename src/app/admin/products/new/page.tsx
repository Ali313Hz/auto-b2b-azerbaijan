import type { Metadata } from "next";
import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

import { createProduct } from "../actions";
import PriceFields from "../PriceFields";

export const metadata: Metadata = {
  title: "Yeni məhsul",
};

export default async function NewProductPage() {
  const { supabase } = await requireOwner();

  const { data: categories, error } = await supabase.rpc(
    "get_admin_categories"
  );

  return (
    <>
      <Link
        href="/admin/products"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Məhsullar
      </Link>

      <PageHeader
        title="Yeni məhsul"
        description="Şəkil və videoları məhsul yaradıldıqdan sonra əlavə edə bilərsiniz."
      />

      {error && <Alert>Kateqoriyalar yüklənmədi.</Alert>}

      {!error && (categories ?? []).length === 0 ? (
        <EmptyState
          title="Əvvəlcə kateqoriya yaradın"
          description="Hər məhsul bir kateqoriyaya aid olmalıdır."
          action={
            <Link href="/admin/categories" className="btn btn-primary">
              Kateqoriyalara keç
            </Link>
          }
        />
      ) : (
        <ActionForm action={createProduct} className="card max-w-3xl space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Məhsul adı *" htmlFor="name">
              <input id="name" name="name" required maxLength={200} className="input" />
            </Field>

            <Field label="SKU *" htmlFor="sku" hint="Unikal məhsul kodu, məs. LED-H4-001">
              <input id="sku" name="sku" required maxLength={64} className="input font-mono" />
            </Field>
          </div>

          <Field label="Təsvir" htmlFor="description">
            <textarea id="description" name="description" rows={4} maxLength={5000} className="input" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kateqoriya *" htmlFor="categoryId">
              <select id="categoryId" name="categoryId" required defaultValue="" className="input">
                <option value="" disabled>
                  Kateqoriya seçin
                </option>
                {(categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.active ? "" : " (deaktiv)"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Status" htmlFor="active">
              <select id="active" name="active" defaultValue="true" className="input">
                <option value="true">Aktiv (satışda)</option>
                <option value="false">Deaktiv (gizli)</option>
              </select>
            </Field>
          </div>

          <PriceFields />

          <div className="flex justify-end border-t border-zinc-800 pt-5">
            <SubmitButton pendingText="Yaradılır...">Məhsulu yarat</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
