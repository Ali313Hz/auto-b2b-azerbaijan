import type { Metadata } from "next";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

import { createCategory, updateCategory } from "./actions";

export const metadata: Metadata = {
  title: "Kateqoriyalar",
};

export default async function AdminCategoriesPage() {
  const { supabase } = await requireOwner();

  const [{ data: categories, error }, { data: products }] = await Promise.all([
    supabase.rpc("get_admin_categories"),
    supabase.rpc("get_admin_products"),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title="Kateqoriyalar" />
        <Alert>Kateqoriyalar yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const productCounts = new Map<string, number>();

  for (const product of products ?? []) {
    if (product.category_id) {
      productCounts.set(
        product.category_id,
        (productCounts.get(product.category_id) ?? 0) + 1
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Kateqoriyalar"
        description="Deaktiv kateqoriyanın məhsulları müştərilərə göstərilmir. Kateqoriyalar sifariş tarixçəsini qorumaq üçün silinmir."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr] lg:items-start">
        <section className="card p-5">
          <h2 className="mb-4 font-semibold text-white">Yeni kateqoriya</h2>

          <ActionForm action={createCategory} resetOnSuccess className="space-y-4">
            <Field label="Ad *" htmlFor="new-name">
              <input id="new-name" name="name" required maxLength={100} className="input" />
            </Field>

            <Field
              label="Slug"
              htmlFor="new-slug"
              hint="Boş qalsa addan avtomatik yaradılır (məs. led-lampalar)."
            >
              <input id="new-slug" name="slug" maxLength={80} className="input font-mono" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Sıra" htmlFor="new-sort">
                <input
                  id="new-sort"
                  type="number"
                  name="sortOrder"
                  min={0}
                  step={1}
                  defaultValue={0}
                  required
                  className="input"
                />
              </Field>

              <Field label="Status" htmlFor="new-active">
                <select id="new-active" name="active" defaultValue="true" className="input">
                  <option value="true">Aktiv</option>
                  <option value="false">Deaktiv</option>
                </select>
              </Field>
            </div>

            <SubmitButton className="btn btn-primary w-full" pendingText="Yaradılır...">
              Kateqoriya yarat
            </SubmitButton>
          </ActionForm>
        </section>

        <section>
          {!categories || categories.length === 0 ? (
            <EmptyState
              title="Hələ kateqoriya yoxdur"
              description="Soldakı formadan ilk kateqoriyanı yaradın."
            />
          ) : (
            <ul className="space-y-3">
              {categories.map((category) => (
                <li key={category.id} className="card p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{category.name}</span>
                    {category.active ? (
                      <Badge tone="green">Aktiv</Badge>
                    ) : (
                      <Badge tone="red">Deaktiv</Badge>
                    )}
                    <Badge>{productCounts.get(category.id) ?? 0} məhsul</Badge>
                  </div>

                  <ActionForm
                    action={updateCategory}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_90px_130px_auto] lg:items-end"
                  >
                    <input type="hidden" name="categoryId" value={category.id} />

                    <Field label="Ad" htmlFor={`name-${category.id}`}>
                      <input
                        id={`name-${category.id}`}
                        name="name"
                        required
                        maxLength={100}
                        defaultValue={category.name}
                        className="input"
                      />
                    </Field>

                    <Field label="Slug" htmlFor={`slug-${category.id}`}>
                      <input
                        id={`slug-${category.id}`}
                        name="slug"
                        required
                        maxLength={80}
                        defaultValue={category.slug}
                        className="input font-mono"
                      />
                    </Field>

                    <Field label="Sıra" htmlFor={`sort-${category.id}`}>
                      <input
                        id={`sort-${category.id}`}
                        type="number"
                        name="sortOrder"
                        min={0}
                        step={1}
                        required
                        defaultValue={category.sort_order}
                        className="input"
                      />
                    </Field>

                    <Field label="Status" htmlFor={`active-${category.id}`}>
                      {/* Keyed so React's post-action form reset cannot
                          show a stale option after the saved value changes. */}
                      <select
                        key={String(category.active)}
                        id={`active-${category.id}`}
                        name="active"
                        defaultValue={category.active ? "true" : "false"}
                        className="input"
                      >
                        <option value="true">Aktiv</option>
                        <option value="false">Deaktiv</option>
                      </select>
                    </Field>

                    <SubmitButton pendingText="...">Yadda saxla</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
