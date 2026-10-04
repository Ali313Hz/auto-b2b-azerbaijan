import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn } from "@/lib/format";
import { signMediaPaths } from "@/lib/media";

import AddToCartForm from "../AddToCartForm";
import ProductImageGallery from "../ProductImageGallery";

export const metadata: Metadata = {
  title: "Məhsul",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductDetailPage({
  params,
}: PageProps<"/products/[id]">) {
  const { id } = await params;

  if (!uuidPattern.test(id)) {
    notFound();
  }

  const { supabase } = await requireCustomer();

  const [{ data: products }, { data: media }] = await Promise.all([
    supabase.rpc("get_customer_catalog"),
    supabase.rpc("get_customer_product_media", { p_product_id: id }),
  ]);

  const product = products?.find((item) => item.id === id);

  if (!product) {
    notFound();
  }

  const mediaItems = media ?? [];
  const urls = await signMediaPaths(
    supabase,
    mediaItems.map((item) => item.storage_path)
  );

  const images = mediaItems
    .filter((item) => item.media_type === "IMAGE")
    .flatMap((item) => {
      const imageUrl = urls.get(item.storage_path);

      return imageUrl
        ? [{ id: item.id, is_primary: item.is_primary, imageUrl }]
        : [];
    });

  const videos = mediaItems
    .filter((item) => item.media_type === "VIDEO")
    .flatMap((item) => {
      const videoUrl = urls.get(item.storage_path);

      return videoUrl ? [{ ...item, videoUrl }] : [];
    });

  return (
    <>
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href="/products" className="hover:text-zinc-200">
          Kataloq
        </Link>

        {product.category_slug && (
          <>
            {" / "}
            <Link
              href={`/products?category=${encodeURIComponent(
                product.category_slug
              )}`}
              className="hover:text-zinc-200"
            >
              {product.category_name}
            </Link>
          </>
        )}
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductImageGallery
          key={product.id}
          images={images}
          productName={product.name}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {product.category_name && <Badge>{product.category_name}</Badge>}

            {product.stock > 0 ? (
              <Badge tone="green">Stokda: {product.stock} əd.</Badge>
            ) : (
              <Badge tone="red">Stokda yoxdur</Badge>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-semibold break-words text-white sm:text-3xl">
            {product.name}
          </h1>

          <p className="mt-2 font-mono text-sm text-zinc-500">
            SKU: {product.sku}
          </p>

          <div className="card mt-6 p-5">
            <p className="text-sm text-zinc-400">Sizin qiymətiniz</p>

            <p className="mt-1 text-3xl font-bold text-amber-400">
              {formatAzn(product.price)}
            </p>

            <div className="mt-4">
              <AddToCartForm productId={product.id} stock={product.stock} />
            </div>
          </div>

          {product.description && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
                Təsvir
              </h2>

              <p className="mt-2 leading-relaxed break-words whitespace-pre-line text-zinc-300">
                {product.description}
              </p>
            </div>
          )}
        </div>
      </div>

      {videos.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-white">
            Məhsul videoları
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {videos.map((video) => (
              <video
                key={video.id}
                src={video.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full rounded-xl border border-zinc-800 bg-black"
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
