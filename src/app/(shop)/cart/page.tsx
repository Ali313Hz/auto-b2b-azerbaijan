import type { Metadata } from "next";
import Link from "next/link";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { formatAzn } from "@/lib/format";

import { changeCartQuantity, createOrder, removeFromCart } from "./actions";

export const metadata: Metadata = {
  title: "Səbət",
};

type CartLine = {
  product_id: string;
  sku: string;
  displayName: string;
  quantity: number;
  unit_price: number;
  regular_price: number;
  line_total: number;
  stock: number;
  available: boolean;
  preorder: boolean;
  overStock: boolean;
};

export default async function CartPage() {
  const { supabase } = await requireCustomer();

  const { data: items, error } = await supabase.rpc("get_customer_cart");

  if (error) {
    return (
      <>
        <PageHeader title="Səbət" />
        <Alert>Səbət yüklənərkən xəta baş verdi. Səhifəni yeniləyin.</Alert>
      </>
    );
  }

  const cartItems: CartLine[] = (items ?? []).map((item) => {
    // `available` is undefined until the availability migration is applied.
    const available = item.available !== false;
    // Decided by the database from the product ("Tezliklə stokda").
    const preorder = item.is_preorder === true;

    return {
      ...item,
      displayName: item.name ?? item.sku,
      available,
      preorder,
      overStock: available && !preorder && item.quantity > item.stock,
    };
  });

  if (cartItems.length === 0) {
    return (
      <>
        <PageHeader title="Səbət" />
        <EmptyState
          title="Səbətiniz boşdur"
          description="Kataloqdan məhsul seçib səbətə əlavə edin."
          action={
            <Link href="/products" className="btn btn-primary">
              Kataloqa keç
            </Link>
          }
        />
      </>
    );
  }

  const normalItems = cartItems.filter((item) => !item.preorder);
  const preorderItems = cartItems.filter((item) => item.preorder);

  return (
    <>
      <PageHeader title="Səbət" />

      {normalItems.length > 0 && preorderItems.length > 0 && (
        <Alert tone="blue">
          Səbətdə həm stokda olan, həm də ön sifariş məhsulları var. Onlar ayrı-ayrı
          sifariş kimi göndərilir.
        </Alert>
      )}

      <div className="space-y-10">
        {normalItems.length > 0 && (
          <CartSection
            title="Stokda olan məhsullar"
            items={normalItems}
            orderType="STANDARD"
            buttonText="Sifarişi təsdiqlə"
            note="Yekun qiymət sifariş anında serverdə hesablanır. Sifariş administrator tərəfindən təsdiqlənəcək."
          />
        )}

        {preorderItems.length > 0 && (
          <CartSection
            title="Ön sifariş"
            description="Bu məhsullar hazırda stokda deyil. Məhsul gələndə sizinlə əlaqə saxlanılacaq."
            items={preorderItems}
            orderType="PREORDER"
            buttonText="Ön sifarişi göndər"
            note="Ön sifariş ayrıca sifariş kimi yaradılır və administrator tərəfindən təsdiqlənəcək."
          />
        )}
      </div>
    </>
  );
}

function CartSection({
  title,
  description,
  items,
  orderType,
  buttonText,
  note,
}: {
  title: string;
  description?: string;
  items: CartLine[];
  orderType: "STANDARD" | "PREORDER";
  buttonText: string;
  note: string;
}) {
  const orderableItems = items.filter((item) => item.available);
  const total = orderableItems.reduce((sum, item) => sum + Number(item.line_total), 0);
  const totalQuantity = orderableItems.reduce((sum, item) => sum + item.quantity, 0);
  const hasProblems = items.some((item) => !item.available || item.overStock);
  const preorder = orderType === "PREORDER";

  return (
    <section aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {preorder && <Badge tone="blue">ÖN SİFARİŞ</Badge>}
      </div>
      {description && <p className="-mt-1 mb-3 text-sm text-zinc-400">{description}</p>}

      {hasProblems && (
        <Alert tone="amber">
          {preorder
            ? "Ön sifarişdə satışda olmayan məhsul var. Göndərməzdən əvvəl onu silin."
            : "Səbətdə satışda olmayan və ya stokdan artıq miqdarda məhsul var. Sifariş verməzdən əvvəl onları düzəldin."}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.product_id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words text-white">{item.displayName}</p>

                  <p className="mt-0.5 font-mono text-xs text-zinc-500">SKU: {item.sku}</p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.preorder && <Badge tone="blue">TEZLİKLƏ STOKDA</Badge>}

                    {!item.available && <Badge tone="red">Satışda deyil</Badge>}

                    {item.overStock && <Badge tone="amber">Stokda {item.stock} əd. var</Badge>}
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-xs text-zinc-500">
                    {Number(item.unit_price) < Number(item.regular_price) && (
                      <span className="mr-1 line-through">{formatAzn(item.regular_price)}</span>
                    )}
                    {formatAzn(item.unit_price)} / əd.
                  </p>

                  <p className="text-lg font-semibold text-white">{formatAzn(item.line_total)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                {item.available ? (
                  <div className="flex items-center gap-2">
                    <ActionForm action={changeCartQuantity} hideSuccess>
                      <input type="hidden" name="productId" value={item.product_id} />
                      <input type="hidden" name="delta" value="-1" />
                      <SubmitButton
                        className="btn btn-secondary h-9 w-9 px-0"
                        pendingText="…"
                        disabled={item.quantity <= 1}
                      >
                        <span aria-hidden>−</span>
                        <span className="sr-only">Azalt</span>
                      </SubmitButton>
                    </ActionForm>

                    <span className="min-w-10 text-center font-semibold" aria-label="Miqdar">
                      {item.quantity}
                    </span>

                    <ActionForm action={changeCartQuantity} hideSuccess>
                      <input type="hidden" name="productId" value={item.product_id} />
                      <input type="hidden" name="delta" value="1" />
                      <SubmitButton
                        className="btn btn-secondary h-9 w-9 px-0"
                        pendingText="…"
                        disabled={!item.preorder && item.quantity >= item.stock}
                      >
                        <span aria-hidden>+</span>
                        <span className="sr-only">Artır</span>
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <span className="text-sm text-zinc-500">Miqdar: {item.quantity}</span>
                )}

                <ActionForm
                  action={removeFromCart}
                  hideSuccess
                  confirmMessage={`"${item.displayName}" səbətdən silinsin?`}
                >
                  <input type="hidden" name="productId" value={item.product_id} />
                  <SubmitButton className="btn btn-danger btn-sm" pendingText="Silinir...">
                    Sil
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>

        <aside className="card p-5 lg:sticky lg:top-24">
          <h3 className="font-semibold text-white">
            {preorder ? "Ön sifariş xülasəsi" : "Sifariş xülasəsi"}
          </h3>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between text-zinc-400">
              <dt>Məhsul sayı</dt>
              <dd>{totalQuantity} əd.</dd>
            </div>

            <div className="flex justify-between border-t border-zinc-800 pt-3 text-base font-semibold text-white">
              <dt>Cəmi</dt>
              <dd className="text-amber-400">{formatAzn(total)}</dd>
            </div>
          </dl>

          <ActionForm action={createOrder} className="mt-5">
            <input type="hidden" name="orderType" value={orderType} />
            <SubmitButton
              className="btn btn-primary w-full py-3"
              pendingText="Göndərilir..."
              disabled={hasProblems}
            >
              {buttonText}
            </SubmitButton>
          </ActionForm>

          <p className="mt-3 text-xs text-zinc-500">{note}</p>
        </aside>
      </div>
    </section>
  );
}
