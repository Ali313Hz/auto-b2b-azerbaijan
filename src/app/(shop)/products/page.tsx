import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import Pagination, { pageHref } from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn, readPage } from "@/lib/format";
import { signCardImages } from "@/lib/media";

import AddToCartForm from "./AddToCartForm";
import CatalogSearch from "./CatalogSearch";

export const metadata: Metadata = {
  title: "Kataloq",
};

const PAGE_SIZE = 24;
const SORTS = ["name", "price_asc", "price_desc", "newest", "sku"];

export default async function ProductsPage({
  searchParams,
}: PageProps<"/products">) {
  const params = await searchParams;
  const selectedCategory =
    typeof params.category === "string" ? params.category.slice(0, 80) : "";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const sort =
    typeof params.sort === "string" && SORTS.includes(params.sort) ? params.sort : "name";
  const page = readPage(params.page);

  const { supabase } = await requireCustomer();

  // One page per request. Price, filtering, search and paging all happen in
  // the database; the response only contains this customer's own price.
  const [{ data: products, error }, { data: categories }] = await Promise.all([
    supabase.rpc("get_customer_catalog_page", {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_category_slug: selectedCategory || null,
      p_search: query || null,
      p_sort: sort,
    }),
    supabase.rpc("get_customer_categories"),
  ]);

  if (error) {
    return (
      <>
        <PageHeader title="Kataloq" />
        <Alert>
          Məhsullar yüklənərkən xəta baş verdi. Səhifəni yeniləyin.
        </Alert>
      </>
    );
  }

  const visibleProducts = products ?? [];
  const total = visibleProducts[0]?.total_count ?? 0;
  const allCategories = categories ?? [];
  const hasFilters = Boolean(selectedCategory || query);

  // Category navigation: main categories, then the children of the selected
  // branch (selected category, its parent or its grandparent).
  const bySlug = new Map(allCategories.map((category) => [category.slug, category]));
  const byId = new Map(allCategories.map((category) => [category.id, category]));
  const selected = bySlug.get(selectedCategory);
  const trail: typeof allCategories = [];

  for (let node = selected; node; node = node.parent_id ? byId.get(node.parent_id) : undefined) {
    trail.unshift(node);
  }

  const levels = [
    allCategories.filter((category) => !category.parent_id),
    ...trail.map((node) => allCategories.filter((category) => category.parent_id === node.id)),
  ].filter((level) => level.length > 0);

  const linkParams = { q: query, sort: sort === "name" ? undefined : sort };
  const categoryHref = (slug: string) =>
    pageHref("/products", { ...linkParams, category: slug || undefined }, 1);

  const imageUrls = await signCardImages(
    supabase,
    visibleProducts.map((product) => product.primary_image_path)
  );

  return (
    <>
      <PageHeader
        title="Kataloq"
        description="Qiymətlər sizin qiymət qrupunuza uyğun göstərilir."
      />

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <nav aria-label="Kateqoriyalar" className="min-w-0 space-y-2">
            {levels.map((level, index) => (
              <div key={index} className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1">
                {index === 0 && (
                  <Link
                    href={categoryHref("")}
                    className={`btn btn-sm ${selectedCategory ? "btn-secondary" : "btn-primary"}`}
                  >
                    Hamısı
                  </Link>
                )}

                {level.map((category) => {
                  const active = trail.some((node) => node.id === category.id);

                  return (
                    <Link
                      key={category.id}
                      href={categoryHref(category.slug)}
                      className={`btn btn-sm whitespace-nowrap ${active ? "btn-primary" : "btn-secondary"}`}
                    >
                      {category.name}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <Suspense fallback={<div className="h-10 w-full lg:w-[30rem]" />}>
            <CatalogSearch />
          </Suspense>
        </div>

        {hasFilters && (
          <p className="text-sm text-zinc-400">
            {total} məhsul tapıldı
            {selected ? ` · ${trail.map((node) => node.name).join(" / ")}` : ""}
          </p>
        )}
      </div>

      {visibleProducts.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Uyğun məhsul tapılmadı" : "Hazırda satışda məhsul yoxdur"}
          description={
            hasFilters
              ? "Başqa kateqoriya seçin və ya axtarış sözünü dəyişin."
              : "Yeni məhsullar əlavə edildikdə burada görünəcək."
          }
          action={
            hasFilters ? (
              <Link href="/products" className="btn btn-secondary">
                Filtrləri sıfırla
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProducts.map((product, index) => {
            const imageUrl = product.primary_image_path
              ? imageUrls.get(product.primary_image_path)
              : undefined;

            return (
              <li
                key={product.id}
                className="card flex min-w-0 flex-col overflow-hidden"
              >
                <Link
                  href={`/products/${product.id}`}
                  className="group block aspect-[4/3] bg-zinc-950"
                >
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={product.name}
                      width={400}
                      height={300}
                      // First row is above the fold; the rest load lazily.
                      loading={index < 4 ? "eager" : "lazy"}
                      decoding="async"
                      className="h-full w-full object-contain p-2 transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-sm text-zinc-600">
                      Şəkil yoxdur
                    </span>
                  )}
                </Link>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {product.category_name && (
                      <Badge>{product.category_name}</Badge>
                    )}

                    {product.stock > 0 ? (
                      <Badge tone="green">Stokda: {product.stock}</Badge>
                    ) : (
                      <Badge tone="red">Stokda yoxdur</Badge>
                    )}
                  </div>

                  <div className="min-w-0">
                    <Link
                      href={`/products/${product.id}`}
                      className="line-clamp-2 font-semibold break-words text-white hover:text-amber-400"
                    >
                      {product.name}
                    </Link>

                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                      SKU: {product.sku}
                    </p>
                  </div>

                  <p className="mt-auto text-xl font-bold text-amber-400">
                    {formatAzn(product.price)}
                  </p>

                  <AddToCartForm
                    productId={product.id}
                    stock={product.stock}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/products"
        params={{ ...linkParams, category: selectedCategory || undefined }}
      />
    </>
  );
}
