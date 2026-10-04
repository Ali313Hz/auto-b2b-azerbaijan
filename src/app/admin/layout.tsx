import type { Metadata } from "next";
import Link from "next/link";

import NavLink from "@/components/NavLink";
import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";
import { requireOwner } from "@/lib/auth";

import { logout } from "../(shop)/account/actions";

export const metadata: Metadata = {
  title: {
    default: "İdarə paneli",
    template: "%s · Admin · Dostlar Auto",
  },
};

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const { staff, user } = await requireOwner();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo />
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-300 uppercase">
              Admin
            </span>
          </Link>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
            <NavLink href="/admin" exact>
              Panel
            </NavLink>
            <NavLink href="/admin/orders">Sifarişlər</NavLink>
            <NavLink href="/admin/products">Məhsullar</NavLink>
            <NavLink href="/admin/categories">Kateqoriyalar</NavLink>
            <NavLink href="/admin/customers">Müştərilər</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-zinc-400 lg:block">
              {staff.full_name ?? user.email}
            </span>

            <form action={logout}>
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
    </div>
  );
}
