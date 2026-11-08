"use client";

import { useActionState, useEffect, useState } from "react";

import { formatAzn } from "@/lib/format";

import {
  type OrderProductOption,
  saveOrderItems,
  searchOrderProducts,
} from "../actions";

export type OrderLine = {
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  stock: number | null;
};

type EditorItem = {
  product_id: string;
  sku: string;
  name: string;
  quantity: string;
  unit_price: string;
  // Stock left in the warehouse (the order's own quantity is already taken).
  stock: number | null;
};

function toNumber(value: string) {
  const text = value.replace(",", ".").trim();

  return text === "" ? NaN : Number(text);
}

function fromLines(lines: OrderLine[]): EditorItem[] {
  return lines.map((line) => ({
    product_id: line.product_id,
    sku: line.sku,
    name: line.product_name,
    quantity: String(line.quantity),
    unit_price: Number(line.unit_price).toFixed(2),
    stock: line.stock,
  }));
}

// Edits a PENDING order in place (OWNER, SALES). Saving changes the order,
// moves stock by the difference and writes the change history; the
// database recalculates every total.
export default function OrderEditor({
  orderId,
  updatedAt,
  lines,
}: {
  orderId: string;
  updatedAt: string;
  lines: OrderLine[];
}) {
  const [state, formAction, pending] = useActionState(saveOrderItems, null);
  const [items, setItems] = useState<EditorItem[]>(() => fromLines(lines));
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<OrderProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [baseVersion, setBaseVersion] = useState(updatedAt);

  // The saved order came back from the server: start from it again
  // (keeps the success message, unlike remounting).
  if (baseVersion !== updatedAt) {
    setBaseVersion(updatedAt);
    setItems(fromLines(lines));
  }

  // Product search (debounced).
  useEffect(() => {
    const query = search.trim();

    if (query.length < 2) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const found = await searchOrderProducts(orderId, query);

      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, orderId]);

  const before = new Map(lines.map((line) => [line.product_id, line]));

  function update(index: number, patch: Partial<EditorItem>) {
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function step(index: number, delta: number) {
    const current = Number.parseInt(items[index].quantity, 10);
    const next = Math.min(100000, Math.max(1, (Number.isFinite(current) ? current : 1) + delta));

    update(index, { quantity: String(next) });
  }

  function addProduct(product: OrderProductOption) {
    const existing = items.findIndex((item) => item.product_id === product.id);

    if (existing >= 0) {
      step(existing, 1);
    } else {
      setItems((list) => [
        ...list,
        {
          product_id: product.id,
          sku: product.sku,
          name: product.name,
          quantity: "1",
          unit_price: product.catalog_price === null ? "" : Number(product.catalog_price).toFixed(2),
          stock: product.stock,
        },
      ]);
    }

    setSearch("");
    setResults([]);
  }

  const rows = items.map((item) => {
    const quantity = Number.parseInt(item.quantity, 10);
    const price = toNumber(item.unit_price);
    const valid =
      /^\d+$/.test(item.quantity.trim()) &&
      quantity >= 1 &&
      quantity <= 100000 &&
      Number.isFinite(price) &&
      price >= 0 &&
      /^\d+([.,]\d{1,2})?$/.test(item.unit_price.trim());
    const old = before.get(item.product_id);
    // Stock that can still be taken: free stock + what this order holds.
    const available = item.stock === null ? null : item.stock + (old?.quantity ?? 0);

    return {
      valid,
      quantity,
      price,
      total: valid ? Math.round(quantity * price * 100) / 100 : null,
      old,
      tooMuch: valid && available !== null && quantity > available,
      available,
    };
  });
  const removed = lines.filter((line) => !items.some((item) => item.product_id === line.product_id));
  const changed =
    removed.length > 0 ||
    rows.some(
      (row) =>
        !row.old ||
        !row.valid ||
        row.quantity !== row.old.quantity ||
        Math.round(row.price * 100) !== Math.round(Number(row.old.unit_price) * 100)
    );
  const allValid = rows.every((row) => row.valid);
  const total = rows.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const payload = JSON.stringify(
    items.map((item) => ({
      product_id: item.product_id,
      quantity: Number.parseInt(item.quantity, 10),
      unit_price: item.unit_price.replace(",", ".").trim(),
    }))
  );

  return (
    <form action={formAction} className="card space-y-5 p-4 sm:p-6">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="expectedUpdatedAt" value={updatedAt} />
      <input type="hidden" name="items" value={payload} />

      <div>
        <h2 className="text-lg font-semibold text-white">Sifarişi dəyiş</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Miqdarı, qiyməti dəyişin, məhsul silin və ya əlavə edin, sonra
          “Dəyişiklikləri yadda saxla” basın. Qiymət dəyişikliyi yalnız bu
          sifarişə aiddir, kataloq qiyməti dəyişmir. Müştəri yenilənmiş
          sifarişi öz səhifəsində görəcək.
        </p>
      </div>

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-red-800 p-4 text-center text-sm text-red-300">
          Sifarişdə məhsul qalmayıb. Ən azı bir məhsul olmalıdır — bütün
          sifarişi ləğv etmək üçün “Sifarişi ləğv et” düyməsini istifadə edin.
        </p>
      )}

      <ul className="space-y-3">
        {items.map((item, index) => {
          const row = rows[index];

          return (
            <li
              key={item.product_id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-white">{item.name}</p>
                  <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
                  {row.old ? (
                    (row.old.quantity !== row.quantity ||
                      Math.round(row.price * 100) !== Math.round(Number(row.old.unit_price) * 100)) && (
                      <p className="mt-1 text-xs text-amber-300">
                        Əvvəl: {row.old.quantity} əd. × {formatAzn(row.old.unit_price)}
                      </p>
                    )
                  ) : (
                    <p className="mt-1 text-xs text-emerald-400">Yeni məhsul</p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-danger shrink-0"
                  onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                  aria-label={`${item.name} sifarişdən sil`}
                >
                  Sil
                </button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                <div>
                  <span className="label">Miqdar</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-secondary px-3 text-lg"
                      onClick={() => step(index, -1)}
                      aria-label="Azalt"
                    >
                      −
                    </button>
                    <input
                      inputMode="numeric"
                      value={item.quantity}
                      onChange={(event) => update(index, { quantity: event.target.value })}
                      className="input w-20 text-center text-lg font-semibold"
                      aria-label={`${item.name} miqdarı`}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary px-3 text-lg"
                      onClick={() => step(index, 1)}
                      aria-label="Artır"
                    >
                      +
                    </button>
                  </div>
                  {row.tooMuch && (
                    <p className="mt-1 text-xs text-red-400">Stokda cəmi {row.available} əd. var.</p>
                  )}
                </div>

                <label className="block">
                  <span className="label">Vahid qiymət</span>
                  <span className="relative block">
                    <input
                      inputMode="decimal"
                      value={item.unit_price}
                      onChange={(event) => update(index, { unit_price: event.target.value })}
                      className="input pr-8 text-lg"
                      aria-label={`${item.name} vahid qiyməti`}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500">
                      ₼
                    </span>
                  </span>
                </label>

                <div className="sm:text-right">
                  <span className="label">Cəmi</span>
                  <p className="py-2 text-lg font-semibold text-white">
                    {row.valid ? formatAzn(row.total) : <span className="text-sm text-red-400">Yanlış dəyər</span>}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {removed.length > 0 && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-3 text-sm text-red-200">
          Sifarişdən çıxarılacaq:{" "}
          {removed.map((line) => `${line.product_name} (${line.quantity} əd.)`).join(", ")}
          . Stoka geri qaytarılacaq.
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 p-3">
        <label htmlFor="productSearch" className="label">
          + Məhsul əlavə et
        </label>
        <input
          id="productSearch"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);

            if (event.target.value.trim().length < 2) {
              setResults([]);
            }
          }}
          placeholder="Məhsulun adını və ya SKU yazın"
          className="input"
          autoComplete="off"
        />
        {searching && <p className="mt-2 text-xs text-zinc-500">Axtarılır...</p>}
        {!searching && search.trim().length >= 2 && results.length === 0 && (
          <p className="mt-2 text-xs text-zinc-500">Satışda belə məhsul tapılmadı.</p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 max-h-72 divide-y divide-zinc-800 overflow-y-auto rounded-lg border border-zinc-800">
            {results.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-3 p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{product.name}</p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-mono">{product.sku}</span> · Stok: {product.stock} ·{" "}
                    {formatAzn(product.catalog_price)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary shrink-0"
                  onClick={() => addProduct(product)}
                >
                  Əlavə et
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-800 pt-4">
        <span className="text-zinc-400">Yeni cəm</span>
        <span className="text-2xl font-bold text-amber-400">{formatAzn(total)}</span>
        <p className="basis-full text-xs text-zinc-500">
          Yekun məbləğ yadda saxlanarkən serverdə yenidən hesablanır.
        </p>
      </div>

      {state && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}>
          {state.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || !changed}
          onClick={() => setItems(fromLines(lines))}
        >
          Dəyişiklikləri geri al
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !changed || !allValid || items.length === 0}
          aria-busy={pending}
        >
          {pending ? "Yadda saxlanılır..." : "Dəyişiklikləri yadda saxla"}
        </button>
      </div>
    </form>
  );
}
