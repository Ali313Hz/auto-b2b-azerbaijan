import type { Metadata } from "next";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { categoryPath, maxCategoryDepth } from "@/lib/format";

import { createCategory, updateCategory } from "./actions";

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

  return (
    <>
      <PageHeader
        title="Kateqoriyalar"
        description="Kateqoriya → alt kateqoriya → alt kateqoriya ... İstənilən kateqoriyanın altına “Alt kateqoriya əlavə et” ilə yenisini yaradın. Deaktiv kateqoriyanın bütün alt kateqoriyalarındakı məhsullar müştərilərə göstərilmir. Kateqoriyalar silinmir."
      />

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

            return (
              <li key={category.id} className="p-3 sm:p-4">
                <div style={indentStyle(category.depth)}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {category.depth > 1 && (
                      <span aria-hidden className="text-zinc-600">
                        └
                      </span>
                    )}
                    <span className={`font-semibold break-words ${category.depth === 1 ? "text-lg text-white" : "text-zinc-100"}`}>
                      {category.name}
                    </span>
                    {!category.active && <Badge tone="red">Deaktiv</Badge>}
                    {category.active && !category.available && (
                      <Badge tone="amber">Ana kateqoriya deaktivdir</Badge>
                    )}
                    <span className="text-xs text-zinc-500">{category.product_count} məhsul</span>
                  </div>

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
