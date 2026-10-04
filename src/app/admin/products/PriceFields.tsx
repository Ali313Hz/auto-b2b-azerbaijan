import { Field } from "@/components/ui";

type PriceFieldsProps = {
  stock?: number;
  normalPrice?: number | null;
  dealerPrice?: number | null;
  vipPrice?: number | null;
};

export default function PriceFields({
  stock,
  normalPrice,
  dealerPrice,
  vipPrice,
}: PriceFieldsProps) {
  const prices = [
    { name: "normalPrice", label: "Normal qiymət (₼) *", value: normalPrice },
    { name: "dealerPrice", label: "Diler qiyməti (₼) *", value: dealerPrice },
    { name: "vipPrice", label: "VIP qiyməti (₼) *", value: vipPrice },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Stok (əd.) *" htmlFor="stock">
        <input
          id="stock"
          type="number"
          name="stock"
          min={0}
          step={1}
          required
          defaultValue={stock ?? ""}
          className="input"
        />
      </Field>

      {prices.map((price) => (
        <Field key={price.name} label={price.label} htmlFor={price.name}>
          <input
            id={price.name}
            type="number"
            name={price.name}
            min={0}
            step="0.01"
            required
            inputMode="decimal"
            defaultValue={price.value ?? ""}
            className="input"
          />
        </Field>
      ))}
    </div>
  );
}
