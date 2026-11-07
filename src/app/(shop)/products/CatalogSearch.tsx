"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const DEBOUNCE_MS = 400;

const sortOptions = [
  { value: "name", label: "Ad (A-Z)" },
  { value: "price_asc", label: "Qiymət: ucuzdan" },
  { value: "price_desc", label: "Qiymət: bahadan" },
  { value: "newest", label: "Ən yenilər" },
  { value: "sku", label: "SKU" },
];

// Server-side search: typing updates the URL after a short pause, the page
// re-renders on the server and only the requested page is fetched.
export default function CatalogSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const lastPushed = useRef(initialQuery);

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    // Any filter change starts from the first page.
    params.delete("page");

    const search = params.toString();

    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed === lastPushed.current) {
      return;
    }

    const timer = setTimeout(() => {
      lastPushed.current = trimmed;
      navigate({ q: trimmed });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // navigate is recreated each render; only the text should re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
      <label htmlFor="catalog-search" className="sr-only">
        Məhsul axtar
      </label>
      <input
        id="catalog-search"
        type="search"
        value={query}
        maxLength={100}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Ad və ya SKU ilə axtar"
        aria-busy={pending}
        className="input sm:w-72"
      />

      <label htmlFor="catalog-sort" className="sr-only">
        Sıralama
      </label>
      <select
        id="catalog-sort"
        value={searchParams.get("sort") ?? "name"}
        onChange={(event) => navigate({ sort: event.target.value === "name" ? "" : event.target.value })}
        className="input sm:w-48"
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
