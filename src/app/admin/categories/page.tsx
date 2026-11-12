import type { Metadata } from "next";
import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import CategoryThumb from "@/components/CategoryThumb";
import ConfirmForm from "@/components/ConfirmForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { categoryPath, maxCategoryDepth } from "@/lib/format";
import { signCardImages } from "@/lib/media";

import { createCategory, deleteCategory, updateCategory } from "./actions";
import CategoryImageEditor from "./CategoryImageEditor";

export const metadata: Metadata = {
  title: "Kateqoriyalar",
};

// Indentation per level, capped so deep trees still fit on a phone.
function indentStyle(depth: number) {
  return { paddingLeft: `${Math.min(depth - 1, 6) * 1.25}rem` };
}

export default async function AdminCategoriesPage() {
  const { supabase } = await requireStaff("categories");

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

  // Children by parent, used to hide a category's own subtree from its
  // "move to" options (the database rejects such moves as well).
  const childrenOf = new Map<string, string[]>();

  for (const category of allCategories) {
    if (category.parent_id) {
      childrenOf.set(category.parent_id, [
        ...(childrenOf.get(category.parent_id) ?? []),
        category.id,
      ]);
    }
  }

  const subtreeOf = (id: string): Set<string> => {
    const result = new Set([id]);
    const queue = [id];

    while (queue.length > 0) {
      for (const child of childrenOf.get(queue.shift() as string) ?? []) {
        result.add(child);
        queue.push(child);
      }
    }

    return result;
  };

  // Products in a category including all of its sub-categories.
  const totalCount = new Map<string, number>();
  const countOf = (id: string): number => {
    if (!totalCount.has(id)) {
      const own = Number(allCategories.find((item) => item.id === id)?.product_count ?? 0);
      totalCount.set(
        id,
        own + (childrenOf.get(id) ?? []).reduce((sum, child) => sum + countOf(child), 0)
      );
    }

    return totalCount.get(id) as number;
  };
  const emptyCount = allCategories.filter((category) => countOf(category.id) === 0).length;

  const imageUrls = await signCardImages(
    supabase,
    allCategories.map((category) => category.image_path)
  );

  return (
    <>
      <PageHeader
        title="Kateqoriyalar"
        description="Kateqoriya → alt kateqoriya → alt kateqoriya ... İstənilən kateqoriyanın altına “Alt kateqoriya əlavə et” ilə yenisini yaradın. Deaktiv kateqoriyanın bütün alt kateqoriyalarındakı məhsullar müştərilərə göstərilmir. Yalnız boş kateqoriya (alt kateqoriyası və məhsulu olmayan) silinə bilər."
      />

      {emptyCount > 0 && (
        <div className="mb-6 rounded-xl border border-amber-600/60 bg-amber-950/30 p-4 text-sm text-amber-100">
          <p className="font-semibold text-amber-300">
            ⚠ {emptyCount} kateqoriya boşdur
          </p>
          <p className="mt-1 text-amber-100/80">
            Bu kateqoriyalarda hələ məhsul yoxdur və aşağıda sarı rənglə
            göstərilib. Müştərilər orada “Tezliklə” yazısını görür — məhsul
            əlavə etməyiniz məsləhətdir.
          </p>
        </div>
      )}

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
            <Field label="Kateqoriya adı *" htmlFor="new-name">
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
        <ul className="card divide-y divide-zinc-800">
          {allCategories.map((category) => {
            const blocked = subtreeOf(category.id);
            const parentOptions = allCategories.filter(
              (option) => !blocked.has(option.id) && option.depth < maxCategoryDepth
            );
            const total = countOf(category.id);
            const own = Number(category.product_count);
            const hasChildren = (childrenOf.get(category.id) ?? []).length > 0;
            const deletable = !hasChildren && own === 0;
            const imageUrl = category.image_path ? imageUrls.get(category.image_path) ?? null : null;

            return (
              <li
                key={category.id}
                className={`p-3 sm:p-4 ${total === 0 ? "border-l-4 border-l-amber-500 bg-amber-950/15" : ""}`}
              >
                <div style={indentStyle(category.depth)}>
                  <div className="flex items-center gap-3">
                    {category.depth > 1 && (
                      <span aria-hidden className="text-zinc-600">
                        └
                      </span>
                    )}
                    <CategoryThumb
                      url={imageUrl}
                      name={category.name}
                      className="size-12 shrink-0 rounded-lg border border-zinc-800"
                      letterClassName="text-lg"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`font-semibold break-words ${category.depth === 1 ? "text-lg text-white" : "text-zinc-100"}`}>
                          {category.name}
                        </span>
                        {!category.active && <Badge tone="red">Deaktiv</Badge>}
                        {category.active && !category.available && (
                          <Badge tone="amber">Ana kateqoriya deaktivdir</Badge>
                        )}
                        {total === 0 && <Badge tone="amber">Boşdur</Badge>}
                      </div>
                      <p className="text-xs text-zinc-500">
                        {own} məhsul
                        {total !== own ? ` · alt kateqoriyalarla cəmi ${total}` : ""}
                      </p>
                    </div>
                  </div>

                  {total === 0 && (
                    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-amber-200">
                        Bu bölmə boşdur — hələ məhsul əlavə olunmayıb. Doldurmağınız məsləhətdir.
                      </p>
                      <Link
                        href={`/admin/products/new?category=${category.id}`}
                        className="btn btn-sm shrink-0 bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
                      >
                        + Məhsul əlavə et
                      </Link>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {category.depth < maxCategoryDepth && (
                      <details className="group w-full sm:w-auto">
                        <summary className="btn btn-secondary btn-sm cursor-pointer list-none">
                          + Alt kateqoriya əlavə et
                        </summary>
                        <ActionForm
                          action={createCategory}
                          resetOnSuccess
                          className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 sm:min-w-96 sm:flex-row sm:items-end"
                        >
                          <input type="hidden" name="parentId" value={category.id} />
                          <input type="hidden" name="active" value="true" />
                          <input type="hidden" name="sortOrder" value="0" />
                          <div className="min-w-0 flex-1">
                            <Field
                              label={`“${category.name}” altında yeni kateqoriya`}
                              htmlFor={`child-${category.id}`}
                            >
                              <input
                                id={`child-${category.id}`}
                                name="name"
                                required
                                maxLength={100}
                                className="input"
                              />
                            </Field>
                          </div>
                          <SubmitButton className="btn btn-primary btn-sm" pendingText="Yaradılır...">
                            Yarat
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}

                    <details className="w-full sm:w-auto">
                      <summary className="btn btn-secondary btn-sm cursor-pointer list-none">
                        Redaktə et
                      </summary>
                      <ActionForm
                        action={updateCategory}
                        className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-2"
                      >
                        <input type="hidden" name="categoryId" value={category.id} />

                        <Field label="Ad *" htmlFor={`name-${category.id}`}>
                          <input
                            id={`name-${category.id}`}
                            name="name"
                            required
                            maxLength={100}
                            defaultValue={category.name}
                            className="input"
                          />
                        </Field>

                        <Field label="Harada yerləşir" htmlFor={`parent-${category.id}`}>
                          <select
                            key={category.parent_id ?? "root"}
                            id={`parent-${category.id}`}
                            name="parentId"
                            defaultValue={category.parent_id ?? ""}
                            className="input"
                          >
                            <option value="">— Əsas kateqoriya —</option>
                            {parentOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {categoryPath(option.path)}
                              </option>
                            ))}
                          </select>
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
                            <option value="true">Aktiv (müştərilər görür)</option>
                            <option value="false">Deaktiv (gizli)</option>
                          </select>
                        </Field>

                        <Field label="Sıra" htmlFor={`sort-${category.id}`} hint="Kiçik rəqəm əvvəldə göstərilir.">
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

                        <Field label="Slug (link adı)" htmlFor={`slug-${category.id}`}>
                          <input
                            id={`slug-${category.id}`}
                            name="slug"
                            required
                            maxLength={80}
                            defaultValue={category.slug}
                            className="input font-mono"
                          />
                        </Field>

                        <div className="flex items-end">
                          <SubmitButton className="btn btn-primary w-full" pendingText="Yadda saxlanılır...">
                            Yadda saxla
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </details>

                    <details className="w-full sm:w-auto">
                      <summary className="btn btn-secondary btn-sm cursor-pointer list-none">
                        {imageUrl ? "Şəkil" : "+ Şəkil əlavə et"}
                      </summary>
                      <CategoryImageEditor
                        categoryId={category.id}
                        name={category.name}
                        imageUrl={imageUrl}
                      />
                    </details>

                    {deletable ? (
                      <ConfirmForm
                        action={deleteCategory}
                        fields={{ categoryId: category.id }}
                        label="Sil"
                        question={`“${category.name}” kateqoriyasını silmək istəyirsiniz?`}
                        description="Kateqoriya boşdur. Silindikdən sonra geri qaytarmaq olmur."
                        confirmLabel="Bəli, sil"
                        pendingText="Silinir..."
                        tone="danger"
                        className="w-full sm:w-auto"
                      />
                    ) : (
                      <span
                        className="self-center text-xs text-zinc-500"
                        title="Silmək üçün əvvəlcə alt kateqoriyaları və məhsulları başqa yerə köçürün."
                      >
                        Silmək olmur: {hasChildren ? "alt kateqoriyası var" : "məhsulu var"}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
