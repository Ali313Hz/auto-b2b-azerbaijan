"use client";

import { useOptimistic, useState, useTransition } from "react";

import { setFavorite } from "./actions";

// ♡ / ♥ on product cards and the product page. The change shows at once and
// is undone if the server refuses it.
export default function FavoriteButton({
  productId,
  productName,
  initial,
  className = "",
}: {
  productId: string;
  productName: string;
  initial: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initial);
  const [favorite, setOptimistic] = useOptimistic(saved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !favorite;

    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setFavorite(productId, next);

      if (result?.ok) {
        setSaved(next);
      } else {
        setError(result?.message ?? "Alınmadı.");
      }
    });
  }

  return (
    <span className={`inline-flex flex-col items-end ${className}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={favorite}
        aria-label={
          favorite
            ? `${productName}: seçilmişlərdən çıxar`
            : `${productName}: seçilmişlərə əlavə et`
        }
        title={favorite ? "Seçilmişlərdən çıxar" : "Seçilmişlərə əlavə et"}
        className={`grid size-10 place-items-center rounded-full border text-xl leading-none transition ${
          favorite
            ? "border-red-500/70 bg-zinc-950/90 text-red-500"
            : "border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:border-red-400 hover:text-red-400"
        }`}
      >
        {favorite ? "♥" : "♡"}
      </button>
      {error && (
        <span role="alert" className="mt-1 max-w-40 rounded bg-zinc-950/90 px-1.5 py-0.5 text-right text-xs text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
