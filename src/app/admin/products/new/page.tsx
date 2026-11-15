import type { Metadata } from "next";
import Link from "next/link";

import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

import ProductCreateForm from "./ProductCreateForm";

export const metadata: Metadata = {
  title: "Yeni məhsul",
};

export default async function NewProductPage({
  searchParams,
}: PageProps<"/admin/products/new">) {
  const { category: categoryParam } = await searchParams;
  const { supabase } = await requireStaff("productsEdit");

  const { data: categories, error } = await supabase.rpc(
    "get_admin_categories"
  );

  // Opened from a category ("+ Məhsul əlavə et"): that category is
  // preselected and the back link returns to it.
  const fromCategory =
    typeof categoryParam === "string"
      ? (categories ?? []).find((category) => category.id === categoryParam)
      : undefined;

  return (
    <>
      <Link
        href={fromCategory ? `/admin/categories/${fromCategory.id}` : "/admin/products"}
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        {fromCategory ? `← ${fromCategory.name}` : "← Məhsullar"}
      </Link>

      <PageHeader
        title="Yeni məhsul"
        description="Məlumatı, qiymətləri, şəkil və videonu doldurun, sonra “Məhsulu yarat” düyməsini basın."
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
        <ProductCreateForm
          // "+ Məhsul əlavə et" on an empty category opens the form with it.
          initialCategoryId={fromCategory?.id ?? ""}
          categories={(categories ?? []).map((category) => ({
            id: category.id,
            name: category.name,
            path: category.path,
            depth: category.depth,
            available: category.available,
          }))}
        />
      )}
    </>
  );
}
