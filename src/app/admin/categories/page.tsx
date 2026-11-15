import type { Metadata } from "next";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

import { createCategory } from "./actions";
import CategoryTree from "./CategoryTree";

export const metadata: Metadata = {
  title: "Kateqoriyalar",
};

export default async function AdminCategoriesPage({
  searchParams,
}: PageProps<"/admin/categories">) {
  const { notice } = await searchParams;
  const { supabase } = await requireStaff("categories");

  // Categories only (with their own product counts). Products are never
  // loaded here; each category's own page lists them page by page.
  const { data: categories, error } = await supabase.rpc("get_admin_categories");

  if (error) {
    return (
      <>
        <PageHeader title="Kateqoriyalar" />
        <Alert>Kateqoriyalar yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const allCategories = categories ?? [];

  return (
    <>
      <PageHeader
        title="Kateqoriyalar"
        description="Əvvəlcə yalnız əsas kateqoriyalar görünür. + düyməsi ilə alt kateqoriyaları açın. ↑ / ↓ düymələri sıranı yalnız eyni ana kateqoriyanın içində dəyişir; müştərilər də eyni sıranı görür. Kateqoriyanın adına basın — orada məhsulları, redaktəni və alt kateqoriya əlavə etməyi tapacaqsınız."
      />

      {notice === "deleted" && <Alert tone="green">Kateqoriya silindi.</Alert>}

      <section className="card mb-6 p-4 sm:p-5">
        <h2 className="mb-3 font-semibold text-white">Yeni əsas kateqoriya</h2>
        <ActionForm
          action={createCategory}
          resetOnSuccess
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="active" value="true" />
          <input type="hidden" name="sortOrder" value="0" />
          <div className="min-w-0 flex-1">
            <Field label="Kateqoriya adı *" htmlFor="new-name" hint="Yeni kateqoriya siyahının sonuna əlavə olunur.">
              <input
                id="new-name"
                name="name"
                required
                maxLength={100}
                className="input"
                placeholder="Məs: Avtomobil işıqlandırması"
              />
            </Field>
          </div>
          <SubmitButton className="btn btn-primary" pendingText="Yaradılır...">
            + Kateqoriya yarat
          </SubmitButton>
        </ActionForm>
      </section>

      {allCategories.length === 0 ? (
        <EmptyState
          title="Hələ kateqoriya yoxdur"
          description="Yuxarıdakı formadan ilk kateqoriyanı yaradın."
        />
      ) : (
        <CategoryTree
          canReorder
          categories={allCategories.map((category) => ({
            id: category.id,
            name: category.name,
            parent_id: category.parent_id,
            root_id: category.root_id,
            depth: category.depth,
            path: category.path,
            active: category.active,
            available: category.available,
            product_count: Number(category.product_count),
            color: category.color,
          }))}
        />
      )}
    </>
  );
}
