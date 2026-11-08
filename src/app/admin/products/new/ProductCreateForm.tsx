"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

import { categoryOptionLabel, formatAzn } from "@/lib/format";

import { createProductDraft, updateProductActive } from "../actions";
import MediaDropZone from "../MediaDropZone";
import {
  formatFileSize,
  imageAccept,
  imageProblem,
  uploadImageFile,
  uploadVideoFile,
  videoAccept,
  videoProblem,
} from "../media-upload";
import PriceBoxes, { type PriceValues } from "../PriceBoxes";

export type CategoryOption = {
  id: string;
  name: string;
  path: string;
  depth: number;
  available: boolean;
};

type PickedFile = { key: string; file: File; url: string };

type Phase =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "done" }
  | { kind: "partial"; productId: string; problems: string[] };

function breadcrumb(path: string) {
  return path.split(" / ").join(" → ");
}

function pick(files: File[], check: (file: File) => string | null) {
  const accepted: PickedFile[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const problem = check(file);

    if (problem) {
      problems.push(`${file.name}: ${problem}`);
    } else {
      accepted.push({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
  }

  return { accepted, problems };
}

export default function ProductCreateForm({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const busy = useRef(false);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [stock, setStock] = useState("");
  const [prices, setPrices] = useState<PriceValues>({ normal: "", dealer: "", vip: "" });
  const [active, setActive] = useState(true);

  const [images, setImages] = useState<PickedFile[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [videos, setVideos] = useState<PickedFile[]>([]);
  const [fileProblems, setFileProblems] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const locked = phase.kind !== "idle";
  const category = categories.find((item) => item.id === categoryId);
  const primary = images.find((image) => image.key === primaryKey) ?? images[0];

  function addImages(files: File[]) {
    const { accepted, problems } = pick(files, imageProblem);

    setFileProblems(problems);
    setImages((current) => [...current, ...accepted]);
  }

  function addVideos(files: File[]) {
    const { accepted, problems } = pick(files, videoProblem);

    setFileProblems(problems);
    setVideos((current) => [...current, ...accepted]);
  }

  function removeImage(key: string) {
    setImages((current) => {
      const removed = current.find((image) => image.key === key);

      if (removed) {
        URL.revokeObjectURL(removed.url);
      }

      return current.filter((image) => image.key !== key);
    });

    if (primaryKey === key) {
      setPrimaryKey(null);
    }
  }

  function removeVideo(key: string) {
    setVideos((current) => {
      const removed = current.find((video) => video.key === key);

      if (removed) {
        URL.revokeObjectURL(removed.url);
      }

      return current.filter((video) => video.key !== key);
    });
  }

  function validate() {
    if (!name.trim()) return "Məhsul adını yazın.";
    if (!sku.trim()) return "SKU yazın.";
    if (!categoryId) return "Kateqoriya seçin.";

    const stockNumber = Number(stock);

    if (stock.trim() === "" || !Number.isInteger(stockNumber) || stockNumber < 0) {
      return "Stok miqdarı 0 və ya daha böyük tam ədəd olmalıdır.";
    }

    for (const value of [prices.normal, prices.dealer, prices.vip]) {
      const price = Number(value);

      if (value.trim() === "" || !Number.isFinite(price) || price < 0) {
        return "Hər üç qiyməti yazın (0 və ya daha böyük).";
      }
    }

    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // A second click while the product is being created does nothing.
    if (busy.current || locked) {
      return;
    }

    const problem = validate();

    if (problem) {
      setError(problem);
      return;
    }

    busy.current = true;
    setError(null);
    setPhase({ kind: "working", text: "Məhsul yaradılır..." });

    const formData = new FormData();

    formData.set("name", name.trim());
    formData.set("sku", sku.trim());
    formData.set("categoryId", categoryId);
    formData.set("description", description.trim());
    formData.set("stock", stock.trim());
    formData.set("normalPrice", prices.normal.trim());
    formData.set("dealerPrice", prices.dealer.trim());
    formData.set("vipPrice", prices.vip.trim());

    let created: Awaited<ReturnType<typeof createProductDraft>>;

    try {
      created = await createProductDraft(formData);
    } catch {
      created = { ok: false, message: "Məhsul yaradılmadı. İnternet bağlantısını yoxlayın." };
    }

    if (!created.ok) {
      busy.current = false;
      setPhase({ kind: "idle" });
      setError(created.message);
      return;
    }

    const productId = created.productId;
    const problems: string[] = [];

    if (!created.contentSaved) {
      problems.push("Məhsulun adı və ya təsviri yadda saxlanmadı.");
    }

    // The first uploaded image becomes the main image, so the chosen main
    // image goes first.
    const ordered = primary
      ? [primary, ...images.filter((image) => image.key !== primary.key)]
      : images;

    for (const [index, image] of ordered.entries()) {
      setPhase({
        kind: "working",
        text: `Şəkillər yüklənir (${index + 1}/${ordered.length})...`,
      });

      const result = await uploadImageFile(productId, image.file);

      if (!result?.ok) {
        problems.push(`${image.file.name}: ${result?.message ?? "Şəkil yüklənmədi."}`);
      }
    }

    for (const [index, video] of videos.entries()) {
      setPhase({
        kind: "working",
        text: `Video yüklənir (${index + 1}/${videos.length})...`,
      });

      const result = await uploadVideoFile(productId, video.file);

      if (!result?.ok) {
        problems.push(`${video.file.name}: ${result?.message ?? "Video yüklənmədi."}`);
      }
    }

    // Anything failed: the product stays inactive and nobody sees it in
    // the catalog until the missing media is added.
    if (problems.length > 0) {
      setPhase({ kind: "partial", productId, problems });
      router.refresh();
      return;
    }

    if (active) {
      setPhase({ kind: "working", text: "Məhsul satışa çıxarılır..." });

      const activeData = new FormData();

      activeData.set("productId", productId);
      activeData.set("active", "true");

      let activated = false;

      try {
        activated = Boolean((await updateProductActive(null, activeData))?.ok);
      } catch {
        activated = false;
      }

      if (!activated) {
        setPhase({
          kind: "partial",
          productId,
          problems: ["Məhsul satışa çıxarılmadı. Məhsul səhifəsində “Aktiv et” düyməsini basın."],
        });
        return;
      }
    }

    setPhase({ kind: "done" });
    router.push(`/admin/products/${productId}?notice=created`);
  }

  const summary = [
    { label: "Məhsul adı", value: name.trim() || "—" },
    { label: "Kateqoriya", value: category ? breadcrumb(category.path) : "—" },
    { label: "Stok", value: stock.trim() ? `${stock.trim()} əd.` : "—" },
    { label: "Normal qiymət", value: prices.normal.trim() ? formatAzn(prices.normal) : "—" },
    { label: "Diler qiyməti", value: prices.dealer.trim() ? formatAzn(prices.dealer) : "—" },
    { label: "VIP qiyməti", value: prices.vip.trim() ? formatAzn(prices.vip) : "—" },
    { label: "Şəkil sayı", value: String(images.length) },
    { label: "Video sayı", value: String(videos.length) },
    { label: "Status", value: active ? "Aktiv (satışda)" : "Deaktiv (gizli)" },
  ];

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-4xl space-y-6">
      <fieldset disabled={locked} className="min-w-0 space-y-6">
        {/* 1. Product information */}
        <section className="card space-y-4 p-4 sm:p-6">
          <SectionTitle number={1} title="Məhsul məlumatı" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="name" className="label">
                Məhsul adı *
              </label>
              <input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
                className="input"
                placeholder="Məs: LED lampa H7 6000K"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor="sku" className="label">
                SKU *
              </label>
              <input
                id="sku"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                maxLength={64}
                required
                className="input font-mono"
                placeholder="LED-H7-001"
              />
              <p className="mt-1 text-xs text-zinc-500">Məs: LED-H7-001. Sonradan dəyişdirilmir.</p>
            </div>
          </div>

          <div className="min-w-0">
            <label htmlFor="categoryId" className="label">
              Kateqoriya *
            </label>
            <select
              id="categoryId"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              required
              className="input"
            >
              <option value="" disabled>
                Kateqoriya seçin
              </option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {categoryOptionLabel(item)}
                  {item.available ? "" : " (deaktiv)"}
                </option>
              ))}
            </select>
            {category && (
              <p className="mt-1 text-sm text-amber-300">{breadcrumb(category.path)}</p>
            )}
          </div>

          <div className="min-w-0">
            <label htmlFor="description" className="label">
              Təsvir
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              maxLength={5000}
              className="input"
            />
          </div>
        </section>

        {/* 2. Price and stock */}
        <section className="card space-y-4 p-4 sm:p-6">
          <SectionTitle number={2} title="Qiymət və stok" />

          <PriceBoxes values={prices} onChange={setPrices} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="stock" className="label">
                Stok miqdarı *
              </label>
              <input
                id="stock"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={stock}
                onChange={(event) => setStock(event.target.value)}
                required
                className="input text-lg"
                placeholder="0"
              />
            </div>

            <div className="min-w-0">
              <span className="label">Status</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Status">
                <StatusChoice
                  checked={active}
                  onSelect={() => setActive(true)}
                  title="Aktiv"
                  text="Satışda"
                  tone="green"
                />
                <StatusChoice
                  checked={!active}
                  onSelect={() => setActive(false)}
                  title="Deaktiv"
                  text="Gizli"
                  tone="zinc"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Images and video */}
        <section className="card space-y-5 p-4 sm:p-6">
          <SectionTitle number={3} title="Şəkillər və video" />

          <div className="space-y-3">
            <MediaDropZone
              id="images"
              title="Şəkil əlavə et"
              hint="Şəkilləri bura sürüşdürün və ya seçin. JPG, PNG, WEBP · maksimum 5 MB."
              accept={imageAccept}
              multiple
              onFiles={addImages}
            />

            {images.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {images.map((image) => {
                  const isPrimary = primary?.key === image.key;

                  return (
                    <li
                      key={image.key}
                      className={`overflow-hidden rounded-lg border-2 bg-zinc-950 ${
                        isPrimary ? "border-amber-500" : "border-zinc-800"
                      }`}
                    >
                      <div className="relative aspect-square">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={image.file.name}
                          className="h-full w-full object-contain p-1"
                        />
                        {isPrimary && (
                          <span className="absolute top-1 left-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
                            Əsas şəkil
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 border-t border-zinc-800 p-2">
                        <p className="truncate text-xs text-zinc-400" title={image.file.name}>
                          {image.file.name} · {formatFileSize(image.file.size)}
                        </p>
                        {!isPrimary && (
                          <button
                            type="button"
                            onClick={() => setPrimaryKey(image.key)}
                            className="btn btn-secondary btn-sm w-full"
                          >
                            Əsas şəkil et
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(image.key)}
                          className="btn btn-danger btn-sm w-full"
                        >
                          Sil
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-3 border-t border-zinc-800 pt-5">
            <MediaDropZone
              id="videos"
              title="Video əlavə et"
              hint="MP4 və ya WEBM · maksimum 50 MB."
              accept={videoAccept}
              multiple
              onFiles={addVideos}
            />

            {videos.length > 0 && (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {videos.map((video) => (
                  <li
                    key={video.key}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 p-2"
                  >
                    <video
                      src={video.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-16 w-24 shrink-0 rounded bg-black object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200" title={video.file.name}>
                        {video.file.name}
                      </p>
                      <p className="text-xs text-zinc-500">{formatFileSize(video.file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVideo(video.key)}
                      className="btn btn-danger btn-sm shrink-0"
                    >
                      Sil
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {fileProblems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-red-400">
              {fileProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </section>

        {/* 4. Final check */}
        <section className="card space-y-4 p-4 sm:p-6">
          <SectionTitle number={4} title="Son kontrol" />

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {summary.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 border-b border-zinc-800 py-1.5"
              >
                <dt className="text-zinc-400">{row.label}</dt>
                <dd className="min-w-0 text-right font-medium break-words text-white">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {phase.kind === "partial" && (
        <div role="alert" className="space-y-3 rounded-lg border border-amber-700 bg-amber-950/30 p-4">
          <p className="font-semibold text-amber-300">
            Məhsul yaradıldı, amma hər şey yüklənmədi. Məhsul deaktiv saxlanıldı və
            müştərilər onu görmür.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-300">
            {phase.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <Link href={`/admin/products/${phase.productId}?notice=media-failed`} className="btn btn-primary">
            Məhsula keç və yenidən yüklə
          </Link>
        </div>
      )}

      {phase.kind === "done" && (
        <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 font-semibold text-emerald-300">
          Məhsul uğurla yaradıldı
        </p>
      )}

      {phase.kind !== "partial" && (
        <button
          type="submit"
          disabled={locked}
          aria-busy={phase.kind === "working"}
          className="btn btn-primary w-full py-4 text-lg sm:w-auto sm:px-10"
        >
          {phase.kind === "working"
            ? phase.text
            : phase.kind === "done"
              ? "Açılır..."
              : "Məhsulu yarat"}
        </button>
      )}
    </form>
  );
}

function SectionTitle({ number, title }: { number: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-semibold text-white">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500 text-sm font-bold text-zinc-950">
        {number}
      </span>
      {title}
    </h2>
  );
}

function StatusChoice({
  checked,
  onSelect,
  title,
  text,
  tone,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
  tone: "green" | "zinc";
}) {
  const activeClass =
    tone === "green"
      ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
      : "border-zinc-400 bg-zinc-800 text-zinc-100";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-lg border-2 px-3 py-2 text-left transition ${
        checked ? activeClass : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
      }`}
    >
      <span className="block font-semibold">{title}</span>
      <span className="block text-xs">{text}</span>
    </button>
  );
}
