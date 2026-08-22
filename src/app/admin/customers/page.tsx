import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function AdminCustomersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.active || staff.role !== "OWNER") {
    redirect("/");
  }

  const { data: customers, error } = await supabase.rpc(
    "get_admin_customers"
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Müşteriler</h1>
        <p className="mt-4 text-red-500">
          Müşteriler yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Müşteriler</h1>

      <div className="mt-6 space-y-4">
        {customers?.map((customer) => (
          <div
            key={customer.id}
            className="rounded-xl border border-zinc-800 p-5"
          >
            <p className="text-lg font-semibold">
              {customer.company_name ?? "Şirket adı yok"}
            </p>

            <p className="mt-2">
              Yetkili: {customer.contact_name ?? "-"}
            </p>

            <p className="mt-2">
              Telefon: {customer.phone ?? "-"}
            </p>

            <p className="mt-2">
              Fiyat grubu: {customer.price_group}
            </p>

            <p className="mt-2">
              Durum: {customer.active ? "Aktif" : "Deaktif"}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}