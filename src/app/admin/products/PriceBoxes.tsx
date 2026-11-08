export type PriceValues = { normal: string; dealer: string; vip: string };

type PriceBoxesProps =
  // Create screen: controlled values for the live summary.
  | { values: PriceValues; onChange: (values: PriceValues) => void; defaults?: never }
  // Edit screen: plain form fields with starting values.
  | { defaults: { normal: number | null; dealer: number | null; vip: number | null }; values?: never; onChange?: never };

const boxes = [
  { key: "normal", name: "normalPrice", title: "Normal qiymət", note: "Adi müştərilər", tone: "border-zinc-600" },
  { key: "dealer", name: "dealerPrice", title: "Diler qiyməti", note: "Diler müştərilər", tone: "border-sky-700" },
  { key: "vip", name: "vipPrice", title: "VIP qiyməti", note: "VIP müştərilər", tone: "border-amber-600" },
] as const;

// Three clearly separate price boxes with the ₼ sign. Each customer only
// ever sees the price of their own group; the server chooses it.
export default function PriceBoxes(props: PriceBoxesProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {boxes.map((box) => (
        <div key={box.key} className={`min-w-0 rounded-xl border-2 bg-zinc-950 p-3 ${box.tone}`}>
          <label htmlFor={box.name} className="block font-semibold text-white">
            {box.title} *
          </label>
          <p className="text-xs text-zinc-500">{box.note}</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={box.name}
              name={box.name}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              required
              placeholder="0.00"
              className="input min-w-0 flex-1 text-xl font-bold"
              {...(props.values
                ? {
                    value: props.values[box.key],
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                      props.onChange({ ...props.values, [box.key]: event.target.value }),
                  }
                : { defaultValue: props.defaults[box.key] ?? "" })}
            />
            <span className="text-xl font-bold text-zinc-400" aria-hidden>
              ₼
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
