import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { signMediaPaths } from "@/lib/media";

import {
  deleteProductImage,
  deleteProductVideo,
  setProductPrimaryImage,
  updateProduct,
  updateProductActive,
  updateProductContent,
  uploadProductImage,
} from "../actions";
import PriceFields from "../PriceFields";
import ProductVideoUpload from "../ProductVideoUpload";

export const metadata: Metadata = {
  title: "Məhsulu redaktə et",
};

const notices: Record<string, { tone: "green" | "amber"; text: string }> = {
  created: { tone: "green", text: "Məhsul yaradıldı. İndi şəkil və video əlavə edə bilərsiniz." },
  "content-failed": {
    tone: "amber",
    text: "Məhsul yaradıldı, lakin ad/təsvir yadda saxlanmadı. Aşağıdan yenidən yadda saxlayın.",
  },
};

export default async function AdminProductDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/products/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireOwner();

  const [{ data: products }, { data: categories }, { data: media }] =
    await Promise.all([
      supabase.rpc("get_admin_products"),
      supabase.rpc("get_admin_categories"),
      supabase.rpc("get_admin_product_media", { p_product_id: id }),
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
  const images = mediaItems.filter((item) => item.media_type === "IMAGE");
  const videos = mediaItems.filter((item) => item.media_type === "VIDEO");
  const notice =
    typeof query.notice === "string" ? notices[query.notice] : undefined;

  return (
    <>
      <Link
        href="/admin/products"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Məhsullar
      </Link>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <PageHeader
        title={product.name}
        description={`SKU: ${product.sku}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {product.active ? (
              <Badge tone="green">Aktiv</Badge>
            ) : (
              <Badge tone="red">Deaktiv</Badge>
            )}

            <ActionForm
              action={updateProductActive}
              className="flex flex-col items-end"
              confirmMessage={
                product.active
                  ? "Məhsul satışdan çıxarılsın? Müştərilər onu görməyəcək."
                  : undefined
              }
            >
              <input type="hidden" name="productId" value={product.id} />
              <input
                type="hidden"
                name="active"
                value={product.active ? "false" : "true"}
              />
              <SubmitButton
                className={`btn ${product.active ? "btn-danger" : "btn-success"}`}
              >
                {product.active ? "Deaktiv et" : "Aktiv et"}
              </SubmitButton>
            </ActionForm>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 font-semibold text-white">Əsas məlumatlar</h2>

          <ActionForm action={updateProductContent} className="space-y-4">
            <input type="hidden" name="productId" value={product.id} />

            <Field label="Məhsul adı *" htmlFor="name">
              <input
                id="name"
                name="name"
                required
                maxLength={200}
                defaultValue={product.name}
                className="input"
              />
            </Field>

            <Field label="Kateqoriya *" htmlFor="categoryId">
              <select
                id="categoryId"
                name="categoryId"
                required
                defaultValue={product.category_id ?? ""}
                className="input"
              >
                <option value="" disabled>
                  Kateqoriya seçin
                </option>
                {(categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.active ? "" : " (deaktiv)"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Təsvir" htmlFor="description">
              <textarea
                id="description"
                name="description"
                rows={5}
                maxLength={5000}
                defaultValue={product.description ?? ""}
                className="input"
              />
            </Field>

            <p className="text-xs text-zinc-500">
              SKU dəyişdirilə bilməz, çünki sifariş tarixçəsində istifadə olunur.
            </p>

            <SubmitButton pendingText="Yadda saxlanılır...">
              Yadda saxla
            </SubmitButton>
          </ActionForm>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 font-semibold text-white">Stok və qiymətlər</h2>

          <ActionForm action={updateProduct} className="space-y-4">
            <input type="hidden" name="productId" value={product.id} />

            <PriceFields
              stock={product.stock}
              normalPrice={product.normal_price}
              dealerPrice={product.dealer_price}
              vipPrice={product.vip_price}
            />

            <p className="text-xs text-zinc-500">
              Müştəri yalnız öz qiymət qrupunun qiymətini görür. Qiymət
              serverdə müştərinin qrupuna görə seçilir.
            </p>

            <SubmitButton pendingText="Yadda saxlanılır...">
              Yadda saxla
            </SubmitButton>
          </ActionForm>
        </section>
      </div>

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="font-semibold text-white">Şəkillər</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Əsas şəkil kataloqda göstərilir. JPG, PNG və ya WEBP, maksimum 5 MB.
        </p>

        {images.length > 0 ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((image) => {
              const imageUrl = urls.get(image.storage_path);

              return (
                <li
                  key={image.id}
                  className={`overflow-hidden rounded-lg border bg-zinc-950 ${
                    image.is_primary ? "border-amber-500" : "border-zinc-800"
                  }`}
                >
                  <div className="aspect-square">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={image.original_name ?? product.name}
                        loading="lazy"
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-xs text-zinc-600">
                        Önizləmə yoxdur
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-zinc-800 p-2">
                    {image.is_primary ? (
                      <Badge tone="amber">Əsas şəkil</Badge>
                    ) : (
                      <ActionForm action={setProductPrimaryImage} hideSuccess>
                        <input type="hidden" name="mediaId" value={image.id} />
                        <input type="hidden" name="productId" value={product.id} />
                        <SubmitButton className="btn btn-secondary btn-sm w-full">
                          Əsas et
                        </SubmitButton>
                      </ActionForm>
                    )}

                    <ActionForm
                      action={deleteProductImage}
                      hideSuccess
                      confirmMessage="Bu şəkil silinsin? Bu əməliyyat geri qaytarılmır."
                    >
                      <input type="hidden" name="mediaId" value={image.id} />
                      <input type="hidden" name="productId" value={product.id} />
                      <SubmitButton
                        className="btn btn-danger btn-sm w-full"
                        pendingText="Silinir..."
                      >
                        Sil
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">Hələ şəkil yoxdur.</p>
        )}

        <ActionForm
          action={uploadProductImage}
          resetOnSuccess
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-zinc-800 pt-5"
        >
          <input type="hidden" name="productId" value={product.id} />

          <div className="min-w-0 flex-1">
            <label htmlFor="image" className="label">
              Yeni şəkil
            </label>
            <input
              id="image"
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              required
              className="input file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-zinc-200"
            />
          </div>

          <SubmitButton pendingText="Yüklənir...">Şəkil yüklə</SubmitButton>
        </ActionForm>
      </section>

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="font-semibold text-white">Videolar</h2>
        <p className="mt-1 text-sm text-zinc-400">
          MP4 və ya WEBM, maksimum 50 MB.
        </p>

        {videos.length > 0 ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {videos.map((video) => {
              const videoUrl = urls.get(video.storage_path);

              return (
                <li key={video.id} className="rounded-lg border border-zinc-800 p-3">
                  {videoUrl ? (
                    <video
                      src={videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-video w-full rounded bg-black"
                    />
                  ) : (
                    <p className="text-sm text-zinc-500">Önizləmə yoxdur</p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-zinc-400">
                      {video.original_name ?? "Video"}
                    </p>

                    <ActionForm
                      action={deleteProductVideo}
                      hideSuccess
                      confirmMessage="Bu video silinsin? Bu əməliyyat geri qaytarılmır."
                    >
                      <input type="hidden" name="mediaId" value={video.id} />
                      <input type="hidden" name="productId" value={product.id} />
                      <SubmitButton
                        className="btn btn-danger btn-sm"
                        pendingText="Silinir..."
                      >
                        Sil
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">Hələ video yoxdur.</p>
        )}

        <div className="mt-5 border-t border-zinc-800 pt-5">
          <ProductVideoUpload productId={product.id} />
        </div>
      </section>

      <p className="mt-6 text-xs text-zinc-500">
        Məhsullar sifariş tarixçəsini qorumaq üçün silinmir. Satışdan
        çıxarmaq üçün “Deaktiv et” istifadə edin.
      </p>
    </>
  );
}
