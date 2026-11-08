import { formatAzn, type RevisionItem } from "@/lib/format";

type RevisionDiffProps = {
  before: RevisionItem[];
  after: RevisionItem[];
  beforeTotal: number;
  afterTotal: number;
};

// Shows what changed between two versions of an order: quantities and
// prices old → new, removed and added products, and both totals.
export default function RevisionDiff({
  before,
  after,
  beforeTotal,
  afterTotal,
}: RevisionDiffProps) {
  const old = new Map(before.map((item) => [item.product_id, item]));
  const next = new Map(after.map((item) => [item.product_id, item]));
  const removed = before.filter((item) => !next.has(item.product_id));

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {after.map((item) => {
          const prev = old.get(item.product_id);
          const qtyChanged = prev && prev.quantity !== item.quantity;
          const priceChanged = prev && Number(prev.unit_price) !== Number(item.unit_price);

          return (
            <li
              key={item.product_id}
              className={`rounded-lg border p-3 ${
                !prev
                  ? "border-emerald-800/60 bg-emerald-950/20"
                  : qtyChanged || priceChanged
                    ? "border-amber-800/60 bg-amber-950/10"
                    : "border-zinc-800"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold break-words text-white">{item.product_name}</p>
                <p className="font-semibold text-white">{formatAzn(item.line_total)}</p>
              </div>
              <p className="font-mono text-xs text-zinc-500">{item.sku}</p>

              {!prev ? (
                <p className="mt-1 text-sm text-emerald-300">
                  Yeni məhsul əlavə edilib · {item.quantity} əd. × {formatAzn(item.unit_price)}
                </p>
              ) : (
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                  <dt className="text-zinc-400">Miqdar:</dt>
                  <dd className={qtyChanged ? "font-semibold text-amber-300" : "text-zinc-300"}>
                    {qtyChanged ? `${prev.quantity} → ${item.quantity}` : item.quantity}
                  </dd>
                  <dt className="text-zinc-400">Qiymət:</dt>
                  <dd className={priceChanged ? "font-semibold text-amber-300" : "text-zinc-300"}>
                    {priceChanged
                      ? `${formatAzn(prev.unit_price)} → ${formatAzn(item.unit_price)}`
                      : formatAzn(item.unit_price)}
                  </dd>
                </dl>
              )}
            </li>
          );
        })}

        {removed.map((item) => (
          <li
            key={item.product_id}
            className="rounded-lg border border-red-900/60 bg-red-950/20 p-3"
          >
            <p className="font-semibold break-words text-zinc-300 line-through">
              {item.product_name}
            </p>
            <p className="font-mono text-xs text-zinc-500">{item.sku}</p>
            <p className="mt-1 text-sm text-red-300">
              Bu məhsul sifarişdən çıxarılıb ({item.quantity} əd.)
            </p>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-zinc-900 p-3 text-sm">
        <dt className="text-zinc-400">Əvvəl:</dt>
        <dd className="text-right text-zinc-300">{formatAzn(beforeTotal)}</dd>
        <dt className="font-semibold text-white">Yeni:</dt>
        <dd className="text-right text-lg font-bold text-amber-400">{formatAzn(afterTotal)}</dd>
      </dl>
    </div>
  );
}
