import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { addToCart } from "./actions";

import ProductImageGallery from "./ProductImageGallery";

export default async function ProductsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: products, error } = await supabase.rpc(
    "get_customer_catalog"
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">
          Məhsullar
        </h1>

        <p className="mt-4 text-red-600">
          Məhsullar yüklənərkən xəta baş verdi.
        </p>
      </main>
    );
  }

  const productsWithMedia = await Promise.all(
    (products ?? []).map(async (product) => {
      const { data: media } = await supabase.rpc(
        "get_customer_product_media",
        {
          p_product_id: product.id,
        }
      );

      const images = (media ?? []).filter(
        (item) => item.media_type === "IMAGE"
      );

      const videos = (media ?? []).filter(
        (item) => item.media_type === "VIDEO"
      );

      const imagesWithUrls = await Promise.all(
        images.map(async (image) => {
          const { data: signedUrlData } =
            await supabase.storage
              .from("product-media")
              .createSignedUrl(
                image.storage_path,
                60 * 60
              );

          return {
            ...image,
            imageUrl:
              signedUrlData?.signedUrl ?? null,
          };
        })
      );

      const videosWithUrls = await Promise.all(
        videos.map(async (video) => {
          const { data: signedUrlData } =
            await supabase.storage
              .from("product-media")
              .createSignedUrl(
                video.storage_path,
                60 * 60
              );

          return {
            ...video,
            videoUrl:
              signedUrlData?.signedUrl ?? null,
          };
        })
      );

      return {
        ...product,
        images: imagesWithUrls,
        videos: videosWithUrls,
      };
    })
  );

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">
        Məhsullar
      </h1>

      {productsWithMedia.length === 0 ? (
        <p className="mt-6">
          Aktiv məhsul tapılmadı.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {productsWithMedia.map((product) => (
            <div
              key={product.id}
              className="rounded-xl border border-zinc-800 p-5"
            >
              <ProductImageGallery
                images={product.images}
                productName={product.name}
              />

              {product.videos.length > 0 && (
                <div className="mt-6">
                  <p className="mb-3 font-semibold">
                    Məhsul videosu
                  </p>

                  <div className="flex flex-wrap gap-4">
                    {product.videos.map((video) =>
                      video.videoUrl ? (
                        <video
                          key={video.id}
                          src={video.videoUrl}
                          controls
                          preload="metadata"
                          className="w-full max-w-xl rounded-lg border border-zinc-800"
                        />
                      ) : null
                    )}
                  </div>
                </div>
              )}

              <p className="mt-5 text-lg font-semibold">
                {product.name}
              </p>

              <p className="mt-1 text-sm text-zinc-400">
                SKU: {product.sku}
              </p>

              {product.description && (
                <p className="mt-3 text-zinc-300">
                  {product.description}
                </p>
              )}

              <p className="mt-2 text-sm text-zinc-400">
                Kategori:{" "}
                {product.category_name ??
                  "Kategorisiz"}
              </p>

              <p className="mt-2">
                Stok: {product.stock}
              </p>

              <p className="mt-2 text-xl font-semibold">
                {product.price} AZN
              </p>

              <form
                action={addToCart}
                className="mt-4"
              >
                <input
                  type="hidden"
                  name="productId"
                  value={product.id}
                />

                <button
                  type="submit"
                  className="rounded-lg bg-white px-4 py-2 font-medium text-black"
                >
                  Sepete ekle
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}