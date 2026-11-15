import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import ConfirmForm from "@/components/ConfirmForm";
import Pagination from "@/components/Pagination";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { categoryColor, categoryPalette, categoryTint } from "@/lib/category-colors";
import { categoryPath, formatAzn, maxCategoryDepth, readPage, uuidPattern } from "@/lib/format";
import { signCardImages } from "@/lib/media";

import { createCategory, deleteCategory, setCategoryColor, updateCategory } from "../actions";
import CategoryImageEditor from "../CategoryImageEditor";

export const metadata: Metadata = {
  title: "Kateqoriya",
};

const PAGE_SIZE = 20;

export default async function AdminCategoryPage({
  params,
  searchParams,
}: PageProps<"/admin/categories/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  if (!uuidPattern.test(id)) {
    notFound();
  }

  const page = readPage(query.page);
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const { supabase } = await requireStaff("categories");

  // The category list (no products) and one page of this category's
  // products (its sub-categories included), filtered in the database.
  const [{ data: categories, error }, { data: products, error: productsError }] =
    await Promise.all([
      supabase.rpc("get_admin_categories"),
      supabase.rpc("get_admin_products_page", {
        p_page: page,
        p_page_size: PAGE_SIZE,
        p_search: search || null,
        p_category_id: id,
        p_sort: "name",
      }),
    ]);

  if (error) {
    return (
      <>
        <PageHeader title="Kateqoriya" />
        <Alert>Kateqoriya yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const allCategories = categories ?? [];
  const category = allCategories.find((item) => item.id === id);

  if (!category) {
    notFound();
  }

  const byId = new Map(allCategories.map((item) => [item.id, item]));
  const childrenOf = new Map<string, typeof allCategories>();

  for (const item of allCategories) {
    if (item.parent_id) {
      childrenOf.set(item.parent_id, [...(childrenOf.get(item.parent_id) ?? []), item]);
    }
  }

  const subtree = new Set([id]);
  const queue = [id];

  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.shift() as string) ?? []) {
      subtree.add(child.id);
      queue.push(child.id);
    }
  }

  const totalOf = (categoryId: string): number =>
    Number(byId.get(categoryId)?.product_count ?? 0) +
    (childrenOf.get(categoryId) ?? []).reduce((sum, child) => sum + totalOf(child.id), 0);

  const trail: typeof allCategories = [];

  for (let node = byId.get(category.parent_id ?? ""); node; node = byId.get(node.parent_id ?? "")) {
    trail.unshift(node);
  }

  const children = childrenOf.get(id) ?? [];
  const total = totalOf(id);
  const own = Number(category.product_count);
  const color = categoryColor(category.root_id, category.color);
  const deletable = children.length === 0 && own === 0;
  const parentOptions = allCategories.filter(
    (option) => !subtree.has(option.id) && option.depth < maxCategoryDepth
  );
  const visibleProducts = products ?? [];
  const found = Number(visibleProducts[0]?.total_count ?? 0);

  const imageUrls = await signCardImages(supabase, [
    category.image_path,
    ...visibleProducts.map((product) => product.primary_image_path),
  ]);
  const imageUrl = category.image_path ? imageUrls.get(category.image_path) ?? null : null;
  const newProductHref = `/admin/products/new?category=${id}`;

  return (
    <>
      <nav aria-label="Kateqoriya yolu" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
        <Link href="/admin/categories" className="hover:text-zinc-200">
          ← Kateqoriyalar
        </Link>
        {trail.map((node) => (
          <span key={node.id} className="flex items-center gap-1">
            <span aria-hidden>›</span>
            <Link href={`/admin/categories/${node.id}`} className="hover:text-zinc-200">
              {node.name}
            </Link>
          </span>
        ))}
      </nav>

      <div
        className="mb-6 border-l-4 pl-4"
        style={{ borderLeftColor: categoryTint(color, category.depth) }}
      >
        <PageHeader
          title={category.name}
          description={categoryPath(category.path)}
          actions={
            <Link href={newProductHref} className="btn btn-primary">
              + Yeni məhsul
            </Link>
          }
        />
        <div className="-mt-3 flex flex-wrap gap-2">
          {!category.active && <Badge tone="red">Deaktiv</Badge>}
          {category.active && !category.available && (
            <Badge tone="amber">Ana kateqoriya deaktivdir</Badge>
          )}
          <Badge tone={total === 0 ? "amber" : "neutral"}>Məhsullar ({total})</Badge>
          {total !== own && <Badge>Birbaşa bu kateqoriyada: {own}</Badge>}
        </div>
      </div>

      <section className="card mb-6 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-white">Alt kateqoriyalar ({children.length})</h2>
        </div>

        {children.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/admin/categories/${child.id}`}
                  className="btn btn-secondary btn-sm border-l-4"
                  style={{ borderLeftColor: categoryTint(color, child.depth) }}
                >
                  {child.name} <span className="text-zinc-500">({totalOf(child.id)})</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {category.depth < maxCategoryDepth ? (
          <ActionForm
            action={createCategory}
            resetOnSuccess
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="parentId" value={id} />
            <input type="hidden" name="active" value="true" />
            <input type="hidden" name="sortOrder" value="0" />
            <div className="min-w-0 flex-1">
              <Field label={`“${category.name}” altında yeni kateqoriya`} htmlFor="child-name">
                <input id="child-name" name="name" required maxLength={100} className="input" />
              </Field>
            </div>
            <SubmitButton className="btn btn-secondary" pendingText="Yaradılır...">
              + Alt kateqoriya əlavə et
            </SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-zinc-500">
            Bu, ən dərin səviyyədir ({maxCategoryDepth}); alt kateqoriya əlavə etmək olmur.
          </p>
        )}
      </section>

      <section className="mb-6" aria-labelledby="products-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="products-title" className="text-lg font-semibold text-white">
              Mövcud məhsullar
            </h2>
            <p className="text-sm text-zinc-500">
              Bu kateqoriyanın və alt kateqoriyalarının məhsulları, səhifə-səhifə.
            </p>
          </div>
          <form action={`/admin/categories/${id}`} className="flex w-full gap-2 sm:w-auto">
            <label htmlFor="category-product-search" className="sr-only">
              Məhsul axtar
            </label>
            <input
              id="category-product-search"
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Ad və ya SKU"
              maxLength={100}
              className="input min-w-0 flex-1 sm:w-56"
            />
            <button type="submit" className="btn btn-secondary">
              Axtar
            </button>
          </form>
        </div>

        {productsError ? (
          <Alert>Məhsullar yüklənmədi.</Alert>
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            title={search ? "Uyğun məhsul tapılmadı" : "Bu kateqoriyada hələ məhsul yoxdur"}
            description={search ? undefined : "Müştərilər burada “Tezliklə” yazısını görür."}
            action={
              <Link href={newProductHref} className="btn btn-primary">
                + Məhsul əlavə et
              </Link>
            }
          />
        ) : (
          <>
            <ul className="card divide-y divide-zinc-800">
              {visibleProducts.map((product) => {
                const url = product.primary_image_path
                  ? imageUrls.get(product.primary_image_path)
                  : undefined;

                return (
                  <li key={product.id}>
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="flex items-center gap-3 p-3 hover:bg-zinc-900/60"
                    >
                      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-950">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-[10px] text-zinc-600">yoxdur</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">{product.name}</span>
                        <span className="block truncate font-mono text-xs text-zinc-500">
                          {product.sku}
                          {product.category_id !== id && product.category_name
                            ? ` · ${product.category_name}`
                            : ""}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-right text-sm sm:block">
                        <span className="block text-zinc-200">
                          {formatAzn(product.sale_price ?? product.normal_price)}
                        </span>
                        <span className={`block text-xs ${product.stock === 0 ? "text-red-400" : "text-zinc-500"}`}>
                          Stok: {product.stock}
                        </span>
                      </span>
                      {product.active ? (
                        <Badge tone="green">Aktiv</Badge>
                      ) : (
                        <Badge tone="red">Deaktiv</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={found}
              basePath={`/admin/categories/${id}`}
              params={{ q: search || undefined }}
            />
          </>
        )}
      </section>

      <section className="card mb-6 p-4 sm:p-5">
        <h2 className="mb-3 font-semibold text-white">Redaktə et</h2>
        <ActionForm action={updateCategory} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="categoryId" value={id} />
          <input type="hidden" name="sortOrder" value="0" />

          <Field label="Ad *" htmlFor="edit-name">
            <input
              id="edit-name"
              name="name"
              required
              maxLength={100}
              defaultValue={category.name}
              className="input"
            />
          </Field>

          <Field
            label="Harada yerləşir"
            htmlFor="edit-parent"
            hint="Başqa yerə köçürülən kateqoriya oradakı siyahının sonuna düşür."
          >
            <select
              key={category.parent_id ?? "root"}
              id="edit-parent"
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

          <Field label="Status" htmlFor="edit-active">
            <select
              key={String(category.active)}
              id="edit-active"
              name="active"
              defaultValue={category.active ? "true" : "false"}
              className="input"
            >
              <option value="true">Aktiv (müştərilər görür)</option>
              <option value="false">Deaktiv (gizli)</option>
            </select>
          </Field>

          <Field label="Slug (link adı)" htmlFor="edit-slug">
            <input
              id="edit-slug"
              name="slug"
              required
              maxLength={80}
              defaultValue={category.slug}
              className="input font-mono"
            />
          </Field>

          <div className="sm:col-span-2">
            <SubmitButton className="btn btn-primary w-full sm:w-auto" pendingText="Yadda saxlanılır...">
              Yadda saxla
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      {!category.parent_id && (
        <section className="card mb-6 p-4 sm:p-5">
          <h2 className="font-semibold text-white">Rəng</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Seçmək məcburi deyil. Alt kateqoriyalar bu rəngin açıq çalarını alır.
          </p>
          <ActionForm action={setCategoryColor} className="flex flex-col gap-3">
            <input type="hidden" name="categoryId" value={id} />
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Rəng seçin</legend>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm has-[:checked]:border-amber-500">
                <input type="radio" name="color" value="" defaultChecked={!category.color} />
                Avtomatik
              </label>
              {categoryPalette.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm has-[:checked]:border-amber-500"
                >
                  <input
                    type="radio"
                    name="color"
                    value={option.value}
                    defaultChecked={category.color === option.value}
                  />
                  <span aria-hidden className="size-4 rounded-full" style={{ backgroundColor: option.value }} />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <div>
              <SubmitButton className="btn btn-secondary" pendingText="Yadda saxlanılır...">
                Rəngi yadda saxla
              </SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}

      <section className="card mb-6 p-4 sm:p-5">
        <h2 className="mb-1 font-semibold text-white">Şəkil</h2>
        <CategoryImageEditor categoryId={id} name={category.name} imageUrl={imageUrl} />
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="mb-2 font-semibold text-white">Silmək</h2>
        {deletable ? (
          <ConfirmForm
            action={deleteCategory}
            fields={{ categoryId: id, returnTo: "list" }}
            label="Kateqoriyanı sil"
            question={`“${category.name}” kateqoriyasını silmək istəyirsiniz?`}
            description="Kateqoriya boşdur. Silindikdən sonra geri qaytarmaq olmur."
            confirmLabel="Bəli, sil"
            pendingText="Silinir..."
            tone="danger"
            className="sm:max-w-sm"
          />
        ) : (
          <p className="text-sm text-zinc-500">
            Silmək olmur: {children.length > 0 ? "alt kateqoriyası var" : "məhsulu var"}. Əvvəlcə
            onları başqa yerə köçürün.
          </p>
        )}
      </section>
    </>
  );
}
