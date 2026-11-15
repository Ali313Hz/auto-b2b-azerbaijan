import type { Metadata } from "next";
import Link from "next/link";

import Pagination from "@/components/Pagination";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn, readPage } from "@/lib/format";
import { signCardImages } from "@/lib/media";

import AddToCartForm from "../products/AddToCartForm";
import FavoriteButton from "../products/FavoriteButton";

export const metadata: Metadata = {
  title: "Seçilmişlər",
};

const PAGE_SIZE = 24;

export default async function FavoritesPage({ searchParams }: PageProps<"/favorites">) {
  const page = readPage((await searchParams).page);
  const { supabase } = await requireCustomer();

  // One page of the customer's own favorites, with prices, in one request.
  const { data, error } = await supabase.rpc("get_customer_favorites_page", {
    p_page: page,
    p_page_size: PAGE_SIZE,
  });

  if (error) {
    return (
      <>
        <PageHeader title="Seçilmişlər" />
        <Alert>Seçilmişlər yüklənərkən xəta baş verdi. Səhifəni yeniləyin.</Alert>
      </>
    );
  }

  const items = data ?? [];
  const total = Number(items[0]?.total_count ?? 0);
  const imageUrls = await signCardImages(
    supabase,
    items.map((item) => item.primary_image_path)
  );

  return (
    <>
      <PageHeader
        title="Seçilmişlər"
        description={total > 0 ? `${total} məhsul` : undefined}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Hələ seçilmiş məhsul yoxdur"
          description="Kataloqda məhsulun üstündəki ♡ işarəsinə basın — məhsul burada görünəcək."
          action={
            <Link href="/products" className="btn btn-primary">
              Kataloqa keç
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const url = item.primary_image_path ? imageUrls.get(item.primary_image_path) : undefined;

            return (
              <li key={item.id} className="card relative flex min-w-0 flex-col overflow-hidden">
                <FavoriteButton
                  productId={item.id}
                  productName={item.name}
                  initial
                  className="absolute top-2 right-2 z-20"
                />
                {item.available ? (
                  <Link href={`/products/${item.id}`} className="block aspect-[4/3] bg-zinc-950">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={item.name}
                        width={400}
                        height={300}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain p-2"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-sm text-zinc-600">Şəkil yoxdur</span>
                    )}
                  </Link>
                ) : (
                  <span className="grid aspect-[4/3] place-items-center bg-zinc-950 text-sm text-zinc-600">
                    Satışda deyil
                  </span>
                )}

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap gap-2">
                    {!item.available ? (
                      <Badge tone="red">Hazırda satışda deyil</Badge>
                    ) : (
                      <>
                        {item.category_name && <Badge>{item.category_name}</Badge>}
                        {item.on_sale && <Badge tone="red">ENDİRİM</Badge>}
                        {item.availability === "COMING_SOON" && <Badge tone="blue">TEZLİKLƏ STOKDA</Badge>}
                      </>
                    )}
                  </div>
                  <div className="min-w-0">
                    {item.available ? (
                      <Link
                        href={`/products/${item.id}`}
                        className="line-clamp-2 font-semibold break-words text-white hover:text-amber-400"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <p className="line-clamp-2 font-semibold break-words text-zinc-400">{item.name}</p>
                    )}
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">SKU: {item.sku}</p>
                  </div>

                  {item.available && item.price !== null && (
                    <>
                      {item.on_sale ? (
                        <p className="mt-auto flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm text-zinc-500 line-through">{formatAzn(item.regular_price)}</span>
                          <span className="text-xl font-bold text-red-400">{formatAzn(item.price)}</span>
                        </p>
                      ) : (
                        <p className="mt-auto text-xl font-bold text-amber-400">{formatAzn(item.price)}</p>
                      )}
                      <AddToCartForm
                        productId={item.id}
                        stock={item.stock ?? 0}
                        comingSoon={item.availability === "COMING_SOON"}
                      />
                    </>
                  )}
                  {!item.available && (
                    <p className="mt-auto text-xs text-zinc-500">
                      Məhsul yenidən satışa çıxanda burada qiyməti görünəcək. ♥ ilə siyahıdan çıxara bilərsiniz.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/favorites" params={{}} />
    </>
  );
}
