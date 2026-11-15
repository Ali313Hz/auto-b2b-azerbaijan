import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";

import { addToCart } from "./actions";

type AddToCartFormProps = {
  productId: string;
  stock: number;
  // "Tezliklə stokda": goes to the pre-order part of the cart, any stock.
  comingSoon?: boolean;
};

export default function AddToCartForm({
  productId,
  stock,
  comingSoon = false,
}: AddToCartFormProps) {
  if (!comingSoon && stock <= 0) {
    return (
      <p className="rounded-lg border border-zinc-800 px-3 py-2 text-center text-sm text-zinc-500">
        Stokda yoxdur
      </p>
    );
  }

  const inputId = `qty-${productId}`;

  return (
    <div className="space-y-2">
      {comingSoon && (
        <p className="rounded-lg border border-sky-800/60 bg-sky-950/40 px-3 py-2 text-xs text-sky-200">
          Bu məhsul hazırda stokda deyil. Ön sifariş kimi əlavə olunacaq.
        </p>
      )}

      <ActionForm
        action={addToCart}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="productId" value={productId} />

        <label htmlFor={inputId} className="sr-only">
          Miqdar
        </label>

        <input
          id={inputId}
          type="number"
          name="quantity"
          min={1}
          max={comingSoon ? 10000 : stock}
          step={1}
          defaultValue={1}
          required
          className="input w-20"
        />

        <SubmitButton
          className={`btn min-w-0 flex-1 ${comingSoon ? "btn-secondary" : "btn-primary"}`}
          pendingText="Əlavə edilir..."
        >
          {comingSoon ? "Ön sifarişə əlavə et" : "Səbətə əlavə et"}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
