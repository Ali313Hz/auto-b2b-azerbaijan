"use client";

import { type ReactNode, useState } from "react";

import { formatAzn } from "@/lib/format";

export type PriceState = {
  normal: string;
  groupPrices: boolean;
  dealer: string;
  vip: string;
  onSale: boolean;
  sale: string;
};

export const emptyPrices: PriceState = {
  normal: "",
  groupPrices: false,
  dealer: "",
  vip: "",
  onSale: false,
  sale: "",
};

function toNumber(value: string) {
  const text = value.replace(",", ".").trim();

  return text === "" ? NaN : Number(text);
}

// Client-side check with the same rules as the server and the database.
export function priceProblem(prices: PriceState) {
  const normal = toNumber(prices.normal);

  if (!Number.isFinite(normal) || normal < 0) {
    return "Normal qiyməti yazın (0 və ya daha böyük).";
  }

  if (prices.groupPrices) {
    for (const value of [prices.dealer, prices.vip]) {
      const price = toNumber(value);

      if (!Number.isFinite(price) || price < 0) {
        return "Diler və VIP qiymətlərini yazın və ya “Diler və VIP qiymətləri əlavə et” işarəsini götürün.";
      }
    }
  }

  if (prices.onSale) {
    const sale = toNumber(prices.sale);

    if (!Number.isFinite(sale) || sale < 0) {
      return "Endirimli qiyməti yazın və ya “Bu məhsul endirimdədir” işarəsini götürün.";
    }

    if (sale >= normal) {
      return "Endirimli qiymət normal qiymətdən aşağı olmalıdır.";
    }
  }

  return null;
}

type Props = {
  // Rendered right after the normal price (e.g. the stock field).
  children?: ReactNode;
  // Existing dealer / VIP prices (edit page): warn before removing them.
  hadGroupPrices?: boolean;
} & (
  | { value: PriceState; onChange: (value: PriceState) => void; initial?: never }
  | { initial: PriceState; value?: never; onChange?: never }
);

function MoneyInput({
  id,
  name,
  value,
  onChange,
  large = false,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  large?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        name={name}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`input min-w-0 flex-1 font-bold ${large ? "text-2xl" : "text-lg"}`}
      />
      <span className="text-xl font-bold text-zinc-400" aria-hidden>
        ₼
      </span>
    </div>
  );
}

// Normal price (required), optional dealer / VIP prices and an optional
// sale price. Field names: normalPrice, groupPrices, dealerPrice, vipPrice,
// onSale, salePrice. Unchecked options are sent empty (= not set).
export default function ProductPriceFields(props: Props) {
  const [own, setOwn] = useState<PriceState>(props.initial ?? emptyPrices);
  const value = props.value ?? own;
  const set = (patch: Partial<PriceState>) => {
    const next = { ...value, ...patch };

    if (props.onChange) {
      props.onChange(next);
    } else {
      setOwn(next);
    }
  };

  const normal = toNumber(value.normal);
  const sale = toNumber(value.sale);
  const saleValid = value.onSale && Number.isFinite(sale) && Number.isFinite(normal) && sale >= 0 && sale < normal;
  const percent = saleValid && normal > 0 ? Math.round((1 - sale / normal) * 100) : null;

  return (
    <div className="space-y-4">
      <input type="hidden" name="groupPrices" value={value.groupPrices ? "1" : ""} />
      <input type="hidden" name="onSale" value={value.onSale ? "1" : ""} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border-2 border-zinc-600 bg-zinc-950 p-3">
          <label htmlFor="normalPrice" className="block font-semibold text-white">
            Normal qiymət *
          </label>
          <p className="mb-2 text-xs text-zinc-500">Müştərilərin gördüyü qiymət</p>
          <MoneyInput
            id="normalPrice"
            name="normalPrice"
            value={value.normal}
            onChange={(normalValue) => set({ normal: normalValue })}
            large
          />
        </div>

        {props.children && <div className="min-w-0">{props.children}</div>}
      </div>

      {/* Optional dealer / VIP prices */}
      <div className="rounded-xl border border-zinc-800 p-3">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-zinc-200">
          <input
            type="checkbox"
            checked={value.groupPrices}
            onChange={(event) => set({ groupPrices: event.target.checked })}
            className="h-5 w-5 accent-amber-500"
          />
          Diler və VIP qiymətləri əlavə et
        </label>

        {value.groupPrices ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="dealerPrice" className="label">
                Diler qiyməti
              </label>
              <MoneyInput
                id="dealerPrice"
                name="dealerPrice"
                value={value.dealer}
                onChange={(dealerValue) => set({ dealer: dealerValue })}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="vipPrice" className="label">
                VIP qiyməti
              </label>
              <MoneyInput
                id="vipPrice"
                name="vipPrice"
                value={value.vip}
                onChange={(vipValue) => set({ vip: vipValue })}
              />
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">
            {props.hadGroupPrices
              ? "Yadda saxlasanız, bu məhsulun diler və VIP qiymətləri silinəcək."
              : "Lazım deyilsə, boş saxlayın."}
          </p>
        )}
      </div>
      {/* Sale */}
      <div
        className={`rounded-xl border-2 p-3 ${
          value.onSale ? "border-red-600 bg-red-950/20" : "border-zinc-800"
        }`}
      >
        <label className="flex cursor-pointer items-center gap-3 font-semibold text-white">
          <input
            type="checkbox"
            checked={value.onSale}
            onChange={(event) => set({ onSale: event.target.checked })}
            className="h-5 w-5 accent-red-600"
          />
          Bu məhsul endirimdədir
        </label>

        {value.onSale && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div className="min-w-0">
              <label htmlFor="salePrice" className="label">
                Endirimli qiymət *
              </label>
              <MoneyInput
                id="salePrice"
                name="salePrice"
                value={value.sale}
                onChange={(saleValue) => set({ sale: saleValue })}
              />
            </div>

            <div className="min-w-0 rounded-lg bg-zinc-950 p-3 text-sm">
              <p className="text-xs text-zinc-500">Müştəri belə görəcək:</p>
              {saleValid ? (
                <p className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-zinc-500 line-through">{formatAzn(normal)}</span>
                  <span className="text-lg font-bold text-red-400">{formatAzn(sale)}</span>
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
                    ENDİRİM{percent ? ` −${percent}%` : ""}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-amber-300">
                  Endirimli qiymət normal qiymətdən aşağı olmalıdır.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
