import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";

import { addToCart } from "./actions";

type AddToCartFormProps = {
  productId: string;
  stock: number;
};

export default function AddToCartForm({
  productId,
  stock,
}: AddToCartFormProps) {
  if (stock <= 0) {
    return (
      <p className="rounded-lg border border-zinc-800 px-3 py-2 text-center text-sm text-zinc-500">
        Stokda yoxdur
      </p>
    );
  }

  const inputId = `qty-${productId}`;

  return (
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
        max={stock}
        step={1}
        defaultValue={1}
        required
        className="input w-20"
      />

      <SubmitButton
        className="btn btn-primary min-w-0 flex-1"
        pendingText="Əlavə edilir..."
      >
        Səbətə əlavə et
      </SubmitButton>
    </ActionForm>
  );
}
