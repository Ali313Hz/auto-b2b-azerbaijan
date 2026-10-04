import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn } from "@/lib/format";
import { signMediaPaths } from "@/lib/media";

import AddToCartForm from "./AddToCartForm";

export const metadata: Metadata = {
  title: "Kataloq",
};

export default async function ProductsPage({
  searchParams,
}: PageProps<"/products">) {
  const params = await searchParams;
  const selectedCategory =
    typeof params.category === "string" ? params.category : "";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const normalizedQuery = query.toLocaleLowerCase("az");

  const { supabase } = await requireCustomer();

  const { data: products, error } = await supabase.rpc(
    "get_customer_catalog"
  );

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

  const allProducts = [...(products ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "az")
  );

  const categories = [
    ...new Map(
      allProducts
        .filter((product) => product.category_slug)
        .map((product) => [
          product.category_slug as string,
          product.category_name ?? (product.category_slug as string),
        ])
    ),
  ].sort((a, b) => a[1].localeCompare(b[1], "az"));

  const visibleProducts = allProducts.filter((product) => {
    if (selectedCategory && product.category_slug !== selectedCategory) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [product.name, product.sku, product.description ?? ""].some(
      (value) => value.toLocaleLowerCase("az").includes(normalizedQuery)
    );
  });

  const imageUrls = await signMediaPaths(
    supabase,
    visibleProducts.map((product) => product.primary_image_path)
  );

  const categoryHref = (slug: string) => {
    const search = new URLSearchParams();

    if (slug) search.set("category", slug);
    if (query) search.set("q", query);

    const value = search.toString();

    return value ? `/products?${value}` : "/products";
  };

  return (
    <>
      <PageHeader
        title="Kataloq"
        description="Qiymətlər sizin qiymət qrupunuza uyğun göstərilir."
      />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav
          aria-label="Kateqoriyalar"
          className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1"
        >
          <Link
            href={categoryHref("")}
            className={`btn btn-sm ${
              selectedCategory ? "btn-secondary" : "btn-primary"
            }`}
          >
            Hamısı
          </Link>

          {categories.map(([slug, name]) => (
            <Link
              key={slug}
              href={categoryHref(slug)}
              className={`btn btn-sm ${
                selectedCategory === slug ? "btn-primary" : "btn-secondary"
              }`}
            >
              {name}
            </Link>
          ))}
        </nav>

        <form action="/products" className="flex w-full gap-2 lg:w-96">
          {selectedCategory && (
            <input type="hidden" name="category" value={selectedCategory} />
          )}

          <label htmlFor="catalog-search" className="sr-only">
            Məhsul axtar
          </label>

          <input
            id="catalog-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Ad və ya SKU ilə axtar"
            className="input"
          />

          <button type="submit" className="btn btn-secondary">
            Axtar
          </button>
        </form>
      </div>

      {visibleProducts.length === 0 ? (
        <EmptyState
          title={
            allProducts.length === 0
              ? "Hazırda satışda məhsul yoxdur"
              : "Uyğun məhsul tapılmadı"
          }
          description={
            allProducts.length === 0
              ? "Yeni məhsullar əlavə edildikdə burada görünəcək."
              : "Başqa kateqoriya seçin və ya axtarış sözünü dəyişin."
          }
          action={
            allProducts.length > 0 ? (
              <Link href="/products" className="btn btn-secondary">
                Filtrləri sıfırla
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProducts.map((product) => {
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
                      loading="lazy"
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
    </>
  );
}
