import type { Metadata } from "next";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

import { createCategory, updateCategory } from "./actions";

export const metadata: Metadata = {
  title: "Kateqoriyalar",
};

const indentClasses = ["", "border-l-4 border-l-zinc-700 sm:ml-6", "border-l-4 border-l-zinc-700 sm:ml-12"];

export default async function AdminCategoriesPage() {
  const { supabase } = await requireOwner();

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

  // A new child must stay within 3 levels.
  const parentOptions = allCategories.filter((category) => category.depth < 3);

  return (
    <>
      <PageHeader
        title="Kateqoriyalar"
        description="Ana kateqoriya → alt kateqoriya → alt-alt kateqoriya (maks. 3 səviyyə). Deaktiv kateqoriyanın və onun bütün alt kateqoriyalarının məhsulları müştərilərə göstərilmir. Kateqoriyalar silinmir."
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

            <Field label="Ana kateqoriya" htmlFor="new-parent">
              <select id="new-parent" name="parentId" defaultValue="" className="input">
                <option value="">— Əsas kateqoriya —</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.path}
                  </option>
                ))}
              </select>
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
          {allCategories.length === 0 ? (
            <EmptyState
              title="Hələ kateqoriya yoxdur"
              description="Soldakı formadan ilk kateqoriyanı yaradın."
            />
          ) : (
            <ul className="space-y-3">
              {allCategories.map((category) => {
                const blocked = subtreeOf(category.id);

                return (
                <li
                  key={category.id}
                  className={`card p-4 ${indentClasses[category.depth - 1] ?? ""}`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{category.name}</span>
                    {category.depth > 1 && (
                      <span className="text-xs text-zinc-500">{category.path}</span>
                    )}
                    {category.active ? (
                      <Badge tone="green">Aktiv</Badge>
                    ) : (
                      <Badge tone="red">Deaktiv</Badge>
                    )}
                    {category.active && !category.available && (
                      <Badge tone="amber">Ana kateqoriya deaktivdir</Badge>
                    )}
                    <Badge>{category.product_count} məhsul</Badge>
                  </div>

                  <ActionForm
                    action={updateCategory}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_80px_120px_auto] lg:items-end"
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

                    <Field label="Ana kateqoriya" htmlFor={`parent-${category.id}`}>
                      <select
                        key={category.parent_id ?? "root"}
                        id={`parent-${category.id}`}
                        name="parentId"
                        defaultValue={category.parent_id ?? ""}
                        className="input"
                      >
                        <option value="">— Əsas —</option>
                        {parentOptions
                          .filter((option) => !blocked.has(option.id))
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.path}
                            </option>
                          ))}
                      </select>
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
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
