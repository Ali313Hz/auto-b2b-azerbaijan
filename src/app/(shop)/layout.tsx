import Link from "next/link";

import NavLink from "@/components/NavLink";
import SubmitButton from "@/components/SubmitButton";
import { Badge, Logo } from "@/components/ui";
import { requireCustomer } from "@/lib/auth";
import { priceGroupLabels } from "@/lib/format";

import { logout } from "./account/actions";

export default async function ShopLayout({
  children,
}: LayoutProps<"/">) {
  const { supabase, customer } = await requireCustomer();

  const { data: cartItems } = await supabase.rpc("get_customer_cart");

  const cartCount = (cartItems ?? []).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/products" aria-label="Dostlar Auto kataloq">
            <Logo />
          </Link>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
            <NavLink href="/products">Kataloq</NavLink>
            <NavLink href="/orders">Sifarişlər</NavLink>
            <NavLink href="/account">Hesab</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right lg:block">
              <p className="max-w-48 truncate text-sm font-medium text-zinc-200">
                {customer.company_name ?? "Müştəri"}
              </p>
              <Badge tone="blue">
                {priceGroupLabels[customer.price_group]}
              </Badge>
            </div>

            <Link
              href="/cart"
              className="btn btn-secondary relative"
              aria-label={`Səbət, ${cartCount} məhsul`}
            >
              Səbət
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-zinc-950">
                {cartCount}
              </span>
            </Link>

            {/* On phones logout lives on the account page to keep one row. */}
            <form action={logout} className="hidden sm:block">
              <SubmitButton
                className="btn btn-secondary"
                pendingText="Çıxılır..."
              >
                Çıxış
              </SubmitButton>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-600">
        © Dostlar Auto · B2B sifariş platforması · Qiymətlər AZN ilə
      </footer>
    </div>
  );
}
