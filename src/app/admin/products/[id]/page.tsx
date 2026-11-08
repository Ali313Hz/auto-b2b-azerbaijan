import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { categoryPath, formatAzn, uuidPattern } from "@/lib/format";
import { can } from "@/lib/roles";
import { signMediaPaths } from "@/lib/media";

import {
  deleteProductImage,
  deleteProductVideo,
  setProductPrimaryImage,
  updateProduct,
  updateProductActive,
  updateProductContent,
  updateProductStock,
} from "../actions";
import ProductPriceFields from "../ProductPriceFields";
import ProductImageUploader from "../ProductImageUploader";
import ProductVideoUpload from "../ProductVideoUpload";

export const metadata: Metadata = {
  title: "Məhsulu redaktə et",
};

const notices: Record<string, { tone: "green" | "amber"; text: string }> = {
  created: { tone: "green", text: "Məhsul uğurla yaradıldı." },
  "media-failed": {
    tone: "amber",
    text: "Məhsul yaradıldı, amma bəzi şəkil və ya videolar yüklənmədi. Məhsul deaktiv saxlanıldı. Aşağıda yenidən yükləyin, sonra “Aktiv et” düyməsini basın.",
  },
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

  if (!uuidPattern.test(id)) {
    notFound();
  }

  const { supabase, role } = await requireStaff("productsView");

  // WAREHOUSE: stock only (the database also hides prices from this role).
  if (!can(role, "productsEdit")) {
    const { data: rows } = await supabase.rpc("get_admin_product", {
      p_product_id: id,
    });
    const item = rows?.[0];

    if (!item) {
      notFound();
    }

    return (
      <>
        <Link
          href="/admin/products"
          className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
        >
          ← Məhsullar
        </Link>

        <PageHeader
          title={item.name}
          description={`SKU: ${item.sku}${item.category_name ? ` · ${item.category_name}` : ""}`}
          actions={
            item.active ? (
              <Badge tone="green">Aktiv</Badge>
            ) : (
              <Badge tone="red">Deaktiv</Badge>
            )
          }
        />

        <section className="card max-w-md p-5 sm:p-6">
          <h2 className="mb-4 font-semibold text-white">Stok</h2>

          <ActionForm action={updateProductStock} className="space-y-4">
            <input type="hidden" name="productId" value={item.id} />

            <Field label="Stok (ədəd)" htmlFor="stock">
              <input
                id="stock"
                name="stock"
                type="number"
                min={0}
                max={1000000}
                step={1}
                required
                defaultValue={item.stock}
                className="input"
              />
            </Field>

            <SubmitButton pendingText="Yadda saxlanılır...">
              Stoku yadda saxla
            </SubmitButton>
          </ActionForm>
        </section>
      </>
    );
  }

  const [{ data: products }, { data: categories }, { data: media }] =
    await Promise.all([
      supabase.rpc("get_admin_product", { p_product_id: id }),
      supabase.rpc("get_admin_categories"),
      supabase.rpc("get_admin_product_media", { p_product_id: id }),
    ]);

  const product = products?.[0];

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

  const sections = [
    { href: "#info", label: "Məlumat" },
    { href: "#prices", label: "Qiymət və stok" },
    { href: "#images", label: `Şəkillər (${images.length})` },
    { href: "#videos", label: `Video (${videos.length})` },
    { href: "#status", label: "Status" },
  ];

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
          <div className="flex flex-wrap gap-2">
            {product.active ? (
              <Badge tone="green">Aktiv · satışda</Badge>
            ) : (
              <Badge tone="red">Deaktiv · gizli</Badge>
            )}
            {product.sale_price !== null && (
              <Badge tone="red">Endirim: {formatAzn(product.sale_price)}</Badge>
            )}
          </div>
        }
      />

      <nav aria-label="Bölmələr" className="mb-6 flex flex-wrap gap-2">
        {sections.map((section) => (
          <a
            key={section.href}
            href={section.href}
            className="rounded-full border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:border-amber-500 hover:text-amber-300"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section id="info" className="card scroll-mt-20 p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Məlumat</h2>

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
                key={product.category_id ?? ""}
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
                    {categoryPath(category.path)}
                    {category.available ? "" : " (deaktiv)"}
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

        <section id="prices" className="card scroll-mt-20 p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Qiymət və stok</h2>

          <ActionForm action={updateProduct} className="space-y-4">
            <input type="hidden" name="productId" value={product.id} />

            <ProductPriceFields
              hadGroupPrices={product.dealer_price !== null || product.vip_price !== null}
              initial={{
                normal: product.normal_price === null ? "" : Number(product.normal_price).toFixed(2),
                groupPrices: product.dealer_price !== null || product.vip_price !== null,
                dealer: product.dealer_price === null ? "" : Number(product.dealer_price).toFixed(2),
                vip: product.vip_price === null ? "" : Number(product.vip_price).toFixed(2),
                onSale: product.sale_price !== null,
                sale: product.sale_price === null ? "" : Number(product.sale_price).toFixed(2),
              }}
            >
              <div className="rounded-xl border-2 border-zinc-800 bg-zinc-950 p-3">
                <label htmlFor="stock" className="block font-semibold text-white">
                  Stok *
                </label>
                <p className="mb-2 text-xs text-zinc-500">Anbarda neçə ədəd var</p>
                <input
                  id="stock"
                  type="number"
                  name="stock"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  required
                  defaultValue={product.stock}
                  className="input text-2xl font-bold"
                />
              </div>
            </ProductPriceFields>

            <SubmitButton pendingText="Yadda saxlanılır...">
              Yadda saxla
            </SubmitButton>
          </ActionForm>
        </section>
      </div>

      <section id="images" className="card mt-6 scroll-mt-20 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-white">Şəkillər</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Əsas şəkil kataloqda göstərilir.
        </p>

        {images.length > 0 ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {images.map((image) => {
              const imageUrl = urls.get(image.storage_path);

              return (
                <li
                  key={image.id}
                  className={`overflow-hidden rounded-lg border-2 bg-zinc-950 ${
                    image.is_primary ? "border-amber-500" : "border-zinc-800"
                  }`}
                >
                  <div className="relative aspect-square">
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
                    {image.is_primary && (
                      <span className="absolute top-1 left-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
                        Əsas şəkil
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-zinc-800 p-2">
                    {!image.is_primary && (
                      <ActionForm action={setProductPrimaryImage} hideSuccess>
                        <input type="hidden" name="mediaId" value={image.id} />
                        <input type="hidden" name="productId" value={product.id} />
                        <SubmitButton className="btn btn-secondary btn-sm w-full">
                          Əsas şəkil et
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

        <div className="mt-5 border-t border-zinc-800 pt-5">
          <ProductImageUploader productId={product.id} />
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section id="videos" className="card scroll-mt-20 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Video</h2>

          {videos.length > 0 ? (
            <ul className="mt-4 space-y-4">
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

        <section id="status" className="card scroll-mt-20 space-y-4 p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-white">Status</h2>

          <div
            className={`rounded-lg border-2 p-4 ${
              product.active
                ? "border-emerald-700 bg-emerald-950/30"
                : "border-zinc-700 bg-zinc-900"
            }`}
          >
            <p className={`text-lg font-bold ${product.active ? "text-emerald-300" : "text-zinc-200"}`}>
              {product.active ? "Aktiv · satışda" : "Deaktiv · gizli"}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {product.active
                ? "Müştərilər bu məhsulu kataloqda görür və sifariş edə bilir."
                : "Müştərilər bu məhsulu görmür."}
            </p>
          </div>

          <ActionForm
            action={updateProductActive}
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
              className={`btn w-full ${product.active ? "btn-danger" : "btn-success"}`}
            >
              {product.active ? "Deaktiv et (satışdan çıxar)" : "Aktiv et (satışa çıxar)"}
            </SubmitButton>
          </ActionForm>

          <p className="text-xs text-zinc-500">
            Məhsullar sifariş tarixçəsini qorumaq üçün silinmir. Satışdan
            çıxarmaq üçün “Deaktiv et” istifadə edin.
          </p>
        </section>
      </div>
    </>
  );
}

