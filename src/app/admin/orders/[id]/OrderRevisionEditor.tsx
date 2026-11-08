"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { formatAzn, type RevisionItem } from "@/lib/format";

import {
  type OrderProductOption,
  saveOrderRevision,
  searchOrderProducts,
} from "../actions";

type EditorItem = {
  product_id: string;
  sku: string;
  name: string;
  quantity: string;
  unit_price: string;
};

type OrderRevisionEditorProps = {
  orderId: string;
  revisionId: string;
  version: number;
  initialItems: RevisionItem[];
  initialNote: string;
  // Currently accepted order items, to show "before" values.
  currentItems: RevisionItem[];
  priceGroupLabel: string;
};

function toNumber(value: string) {
  const number = Number(value.replace(",", ".").trim());

  return Number.isFinite(number) ? number : NaN;
}

export default function OrderRevisionEditor({
  orderId,
  revisionId,
  version,
  initialItems,
  initialNote,
  currentItems,
  priceGroupLabel,
}: OrderRevisionEditorProps) {
  const [state, formAction, pending] = useActionState(saveOrderRevision, null);
  const [items, setItems] = useState<EditorItem[]>(() =>
    initialItems.map((item) => ({
      product_id: item.product_id,
      sku: item.sku,
      name: item.product_name,
      quantity: String(item.quantity),
      unit_price: Number(item.unit_price).toFixed(2),
    }))
  );
  const [note, setNote] = useState(initialNote);
  const [confirmSend, setConfirmSend] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<OrderProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [handledState, setHandledState] = useState(state);
  const sendRef = useRef<HTMLButtonElement>(null);

  if (state !== handledState) {
    setHandledState(state);
    setConfirmSend(false);
  }

  useEffect(() => {
    if (confirmSend) {
      sendRef.current?.focus();
    }
  }, [confirmSend]);

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

  const before = new Map(currentItems.map((item) => [item.product_id, item]));

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
        },
      ]);
    }

    setSearch("");
    setResults([]);
  }

  const lines = items.map((item) => {
    const quantity = Number.parseInt(item.quantity, 10);
    const price = toNumber(item.unit_price);
    const valid =
      /^\d+$/.test(item.quantity.trim()) &&
      quantity >= 1 &&
      quantity <= 100000 &&
      item.unit_price.trim() !== "" &&
      price >= 0;

    return { valid, total: valid ? Math.round(quantity * price * 100) / 100 : null };
  });
  const allValid = lines.every((line) => line.valid);
  const total = lines.reduce((sum, line) => sum + (line.total ?? 0), 0);
  const payload = JSON.stringify(
    items.map((item) => ({
      product_id: item.product_id,
      quantity: Number.parseInt(item.quantity, 10),
      unit_price: item.unit_price,
    }))
  );
  const removed = currentItems.filter(
    (item) => !items.some((edited) => edited.product_id === item.product_id)
  );

  return (
    <form action={formAction} className="card space-y-5 p-4 sm:p-6">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="items" value={payload} />

      <div>
        <h2 className="text-lg font-semibold text-white">
          Dəyişiklik · Versiya {version}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Qaralama: müştəri “Müştəriyə göndər” basılana qədər görmür. Stok
          yalnız müştəri qəbul etdikdə dəyişir. Qiymət dəyişikliyi yalnız bu
          sifarişə aiddir, kataloq qiymətləri ({priceGroupLabel}) dəyişmir.
        </p>
      </div>

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-400">
          Sifarişdə məhsul qalmayıb. Aşağıdan məhsul əlavə edin.
        </p>
      )}

      <ul className="space-y-3">
        {items.map((item, index) => {
          const old = before.get(item.product_id);
          const line = lines[index];

          return (
            <li
              key={item.product_id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-white">{item.name}</p>
                  <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
                  {old ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      Əvvəl: {old.quantity} əd. × {formatAzn(old.unit_price)}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-400">Yeni məhsul</p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary shrink-0 text-red-300"
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
                      className="btn btn-secondary px-3"
                      onClick={() => step(index, -1)}
                      aria-label="Azalt"
                    >
                      −
                    </button>
                    <input
                      inputMode="numeric"
                      value={item.quantity}
                      onChange={(event) => update(index, { quantity: event.target.value })}
                      className="input w-20 text-center"
                      aria-label={`${item.name} miqdarı`}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary px-3"
                      onClick={() => step(index, 1)}
                      aria-label="Artır"
                    >
                      +
                    </button>
                  </div>
                </div>

                <label className="block">
                  <span className="label">Vahid qiymət</span>
                  <span className="relative block">
                    <input
                      inputMode="decimal"
                      value={item.unit_price}
                      onChange={(event) => update(index, { unit_price: event.target.value })}
                      className="input pr-8"
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
                    {line.valid ? formatAzn(line.total) : <span className="text-sm text-red-400">Yanlış dəyər</span>}
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
          {removed.map((item) => `${item.product_name} (${item.quantity} əd.)`).join(", ")}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 p-3">
        <label htmlFor="productSearch" className="label">
          Məhsul əlavə et
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
          placeholder="Ad və ya SKU yazın (ən azı 2 simvol)"
          className="input"
          autoComplete="off"
        />
        {searching && <p className="mt-2 text-xs text-zinc-500">Axtarılır...</p>}
        {results.length > 0 && (
          <ul className="mt-2 max-h-72 divide-y divide-zinc-800 overflow-y-auto rounded-lg border border-zinc-800">
            {results.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-3 p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{product.name}</p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-mono">{product.sku}</span> · Stok: {product.stock} ·{" "}
                    {formatAzn(product.catalog_price)}
                    {!product.active && <span className="text-amber-400"> · satışda deyil</span>}
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

      <div>
        <label htmlFor="revisionNote" className="label">
          Satıcı qeydi (müştəri görəcək)
        </label>
        <textarea
          id="revisionNote"
          name="note"
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="input"
          placeholder="Məs: H7 LED stokda 1 ədəd qalıb, qiymət endirimlə 42 ₼."
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-800 pt-4">
        <span className="text-zinc-400">Yeni cəm (təxmini)</span>
        <span className="text-2xl font-bold text-amber-400">{formatAzn(total)}</span>
        <p className="basis-full text-xs text-zinc-500">
          Yekun məbləğ saxlanarkən serverdə yenidən hesablanır.
        </p>
      </div>

      {state && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}>
          {state.message}
        </p>
      )}

      {!confirmSend ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="submit"
            name="intent"
            value="save"
            className="btn btn-secondary"
            disabled={pending || !allValid}
            aria-busy={pending}
          >
            {pending ? "Saxlanılır..." : "Dəyişiklikləri saxla"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !allValid || items.length === 0}
            onClick={() => setConfirmSend(true)}
          >
            Müştəriyə göndər
          </button>
        </div>
      ) : (
        <div role="alertdialog" aria-label="Müştəriyə göndər" className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3">
          <p className="text-sm font-medium text-white">
            Dəyişikliklər müştəriyə göndərilsin?
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Müştəri yeni cəmi ({formatAzn(total)}) görüb qəbul və ya rədd edəcək.
            Qəbul edənə qədər sifariş və stok dəyişmir.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              disabled={pending}
              onClick={() => setConfirmSend(false)}
            >
              İmtina
            </button>
            <button
              ref={sendRef}
              type="submit"
              name="intent"
              value="send"
              className="btn btn-primary flex-1"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "Göndərilir..." : "Bəli, göndər"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
