import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
        <p className="mt-2 text-zinc-400">
          Müşteri, ürün ve stok yönetimi buraya eklenecek.
        </p>
      </div>
    </main>
  );
}