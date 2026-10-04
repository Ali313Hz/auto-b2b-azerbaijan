import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const adminLinks = [
  { href: "/admin/orders", label: "Siparişler" },
  { href: "/admin/products", label: "Ürünler" },
  { href: "/admin/categories", label: "Kategoriler" },
  { href: "/admin/customers", label: "Müşteriler" },
] as const;

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staff, error } = await supabase
    .from("staff_profiles")
    .select("full_name, role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (
    error ||
    !staff ||
    !staff.active ||
    staff.role !== "OWNER"
  ) {
    redirect("/");
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Admin Paneli</h1>

      <div className="mt-6 space-y-2">
        <p>Ad: {staff.full_name ?? "-"}</p>
        <p>Rol: {staff.role}</p>
        <p>Status: {staff.active ? "Aktif" : "Deaktif"}</p>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-800 p-5">
        <h2 className="text-lg font-semibold">Yönetim</h2>
        <nav className="mt-4 grid gap-3 sm:grid-cols-2">
          {adminLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-zinc-800 px-4 py-3 font-medium hover:bg-zinc-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}