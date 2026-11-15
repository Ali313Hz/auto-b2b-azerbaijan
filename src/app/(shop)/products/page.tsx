import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import CategoryThumb from "@/components/CategoryThumb";
import Pagination, { pageHref } from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn, readPage } from "@/lib/format";
import { signCardImages } from "@/lib/media";

import AddToCartForm from "./AddToCartForm";
import CatalogSearch from "./CatalogSearch";
import CategorySidebar from "./CategorySidebar";
import FavoriteButton from "./FavoriteButton";

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
  const saleOnly = params.sale === "1";

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
      p_on_sale: saleOnly,
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
  const hasFilters = Boolean(selectedCategory || query || saleOnly);

  // Category navigation: main categories, then the children of the selected
  // branch (selected category, its parent or its grandparent).
  const bySlug = new Map(allCategories.map((category) => [category.slug, category]));
  const byId = new Map(allCategories.map((category) => [category.id, category]));
  const selected = bySlug.get(selectedCategory);
  const trail: typeof allCategories = [];

  for (let node = selected; node; node = node.parent_id ? byId.get(node.parent_id) : undefined) {
    trail.unshift(node);
  }

  const linkParams = {
    q: query,
    sort: sort === "name" ? undefined : sort,
    sale: saleOnly ? "1" : undefined,
  };
  const categoryHref = (slug: string) =>
    pageHref("/products", { ...linkParams, category: slug || undefined }, 1);

  // Products a customer can see in a category including its sub-categories.
  const totals = new Map<string, number>();
  const totalOf = (id: string): number => {
    if (!totals.has(id)) {
      const own = Number(byId.get(id)?.product_count ?? 0);
      totals.set(
        id,
        own +
          allCategories
            .filter((category) => category.parent_id === id)
            .reduce((sum, child) => sum + totalOf(child.id), 0)
      );
    }

    return totals.get(id) as number;
  };

  // Older database versions return no counts: then no count labels at all.
  const countsKnown = allCategories.every((category) => category.product_count != null);

  // Browsing (no search, no sale filter): sub-categories as picture cards.
  const browsing = !query && !saleOnly;
  const cardCategories = browsing
    ? allCategories.filter((category) => (category.parent_id ?? null) === (selected?.id ?? null))
    : [];
  // The catalog result decides: a category is "empty" only when it really
  // returned no products (counts are only used for the card labels).
  const emptyCategory = Boolean(selected && browsing && visibleProducts.length === 0);

  // One signing request for product and category pictures, and one
  // request for which products on this page are favorites.
  const [imageUrls, { data: favoriteIds }] = await Promise.all([
    signCardImages(supabase, [
      ...visibleProducts.map((product) => product.primary_image_path),
      ...cardCategories.map((category) => category.image_path),
    ]),
    visibleProducts.length > 0
      ? supabase.rpc("get_customer_favorite_ids", {
          p_product_ids: visibleProducts.map((product) => product.id),
        })
      : Promise.resolve({ data: [] as string[] }),
  ]);
  const favorites = new Set<string>(favoriteIds ?? []);

  // Sidebar: categories only (no products), in the admin's order.
  const sidebarHrefs = Object.fromEntries(
    allCategories.map((category) => [category.slug, categoryHref(category.slug)])
  );

  return (
    <>
      <PageHeader
        title={saleOnly ? "Endirimdə olan məhsullar" : "Kataloq"}
        description={saleOnly ? "Yalnız hazırda endirimdə olan məhsullar." : undefined}
        actions={
          saleOnly ? (
            <Link
              href={pageHref("/products", { ...linkParams, sale: undefined, category: selectedCategory || undefined }, 1)}
              className="btn btn-secondary"
            >
              Bütün məhsullar
            </Link>
          ) : (
            <Link
              href={pageHref("/products", { ...linkParams, sale: "1", category: selectedCategory || undefined }, 1)}
              className="btn bg-red-600 font-semibold text-white hover:bg-red-500"
            >
              % Endirimdə olanlar
            </Link>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
      <CategorySidebar
        categories={allCategories.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          parent_id: category.parent_id,
        }))}
        selectedSlug={selected ? selectedCategory : ""}
        hrefs={sidebarHrefs}
        allHref={categoryHref("")}
      />

      <div className="min-w-0">
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          {/* A simple path back up; sub-categories are the cards below. */}
          <nav aria-label="Kateqoriya yolu" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2 text-sm">
              <Link
                href={categoryHref("")}
                className={`btn btn-sm ${selected ? "btn-secondary" : "btn-primary"}`}
              >
                Bütün kateqoriyalar
              </Link>
              {trail.map((node, index) => (
                <span key={node.id} className="flex items-center gap-1">
                  <span aria-hidden className="text-zinc-600">›</span>
                  <Link
                    href={categoryHref(node.slug)}
                    aria-current={index === trail.length - 1 ? "page" : undefined}
                    className={`btn btn-sm whitespace-nowrap ${index === trail.length - 1 ? "btn-primary" : "btn-secondary"}`}
                  >
                    {node.name}
                  </Link>
                </span>
              ))}
            </nav>

          <Suspense fallback={<div className="h-10 w-full xl:w-[26rem]" />}>
            <CatalogSearch />
          </Suspense>
        </div>

        {cardCategories.length > 0 && (
          <section aria-label={selected ? `${selected.name} alt kateqoriyaları` : "Kateqoriyalar"}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {cardCategories.map((category, index) => {
                const count = totalOf(category.id);
                const url = category.image_path ? imageUrls.get(category.image_path) : undefined;

                return (
                  <li key={category.id} className="min-w-0">
                    <Link
                      href={categoryHref(category.slug)}
                      className="card group flex h-full flex-col overflow-hidden transition hover:border-amber-500/70"
                    >
                      <span className="relative block aspect-[4/3] overflow-hidden">
                        <CategoryThumb
                          url={url}
                          name={category.name}
                          eager={index < 6}
                          className="h-full w-full transition-transform group-hover:scale-[1.03]"
                          letterClassName="text-4xl"
                        />
                        {countsKnown && count === 0 && (
                          <span className="absolute top-2 left-2 rounded bg-zinc-950/80 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                            Tezliklə
                          </span>
                        )}
                      </span>
                      <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                        <span className="line-clamp-2 text-sm font-semibold break-words text-white group-hover:text-amber-400">
                          {category.name}
                        </span>
                        {countsKnown && (
                          <span className="text-xs text-zinc-500">
                            {count > 0 ? `${count} məhsul` : "Hələ məhsul yoxdur"}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {hasFilters && (
          <p className="text-sm text-zinc-400">
            {total} məhsul tapıldı
            {saleOnly ? " · endirimdə" : ""}
            {selected ? ` · ${trail.map((node) => node.name).join(" › ")}` : ""}
          </p>
        )}
      </div>

      {emptyCategory && selected ? (
        <EmptyState
          title="Bu kateqoriyaya hələ məhsul əlavə olunmayıb"
          description={`“${selected.name}” bölməsində tezliklə yeni məhsullar olacaq. Hələlik digər kateqoriyalara baxa bilərsiniz.`}
          action={
            <Link href="/products" className="btn btn-secondary">
              Bütün kateqoriyalar
            </Link>
          }
        />
      ) : visibleProducts.length === 0 ? (
        <EmptyState
          title={
            saleOnly && !selectedCategory && !query
              ? "Hazırda endirimdə məhsul yoxdur"
              : hasFilters
                ? "Uyğun məhsul tapılmadı"
                : "Hazırda satışda məhsul yoxdur"
          }
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProducts.map((product, index) => {
            const imageUrl = product.primary_image_path
              ? imageUrls.get(product.primary_image_path)
              : undefined;

            return (
              <li
                key={product.id}
                className="card relative flex min-w-0 flex-col overflow-hidden"
              >
                <FavoriteButton
                  productId={product.id}
                  productName={product.name}
                  initial={favorites.has(product.id)}
                  className="absolute top-2 right-2 z-20"
                />
                <Link
                  href={`/products/${product.id}`}
                  className="group relative block aspect-[4/3] bg-zinc-950"
                >
                  {product.on_sale && (
                    <span className="absolute top-2 left-2 z-10 rounded bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
                      ENDİRİM
                    </span>
                  )}
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

                    {product.availability === "COMING_SOON" ? (
                      <Badge tone="blue">TEZLİKLƏ STOKDA</Badge>
                    ) : product.stock > 0 ? (
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

                  <PriceTag price={product.price} regular={product.regular_price} onSale={product.on_sale} />

                  <AddToCartForm
                    productId={product.id}
                    stock={product.stock}
                    comingSoon={product.availability === "COMING_SOON"}
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
      </div>
      </div>
    </>
  );
}

function PriceTag({
  price,
  regular,
  onSale,
}: {
  price: number;
  regular: number;
  onSale: boolean;
}) {
  return onSale ? (
    <p className="mt-auto flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm text-zinc-500 line-through">{formatAzn(regular)}</span>
      <span className="text-xl font-bold text-red-400">{formatAzn(price)}</span>
    </p>
  ) : (
    <p className="mt-auto text-xl font-bold text-amber-400">{formatAzn(price)}</p>
  );
}
