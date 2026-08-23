import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  createCustomer,
  updateCustomerActive,
  updateCustomerPriceGroup,
} from "./actions";

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

      <form
        action={createCustomer}
        className="mt-6 space-y-4 rounded-xl border border-zinc-800 p-5"
      >
        <h2 className="text-xl font-semibold">
          Yeni Müşteri Ekle
        </h2>

        <div>
          <label className="block text-sm">E-posta</label>

          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Geçici şifre
          </label>

          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />

          <p className="mt-1 text-xs text-zinc-400">
            En az 8 karakter.
          </p>
        </div>

        <div>
          <label className="block text-sm">
            Şirket adı
          </label>

          <input
            name="companyName"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Yetkili kişi
          </label>

          <input
            name="contactName"
            required
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">Telefon</label>

          <input
            type="tel"
            name="phone"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Fiyat grubu
          </label>

          <select
            name="priceGroup"
            defaultValue="NORMAL"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          >
            <option value="NORMAL">NORMAL</option>
            <option value="DEALER">DEALER</option>
            <option value="VIP">VIP</option>
          </select>
        </div>

        <div>
          <label className="block text-sm">Durum</label>

          <select
            name="active"
            defaultValue="true"
            className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
          >
            <option value="true">Aktif</option>
            <option value="false">Deaktif</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
        >
          Müşteri Oluştur
        </button>
      </form>

      {!customers || customers.length === 0 ? (
        <p className="mt-8">Müşteri bulunamadı.</p>
      ) : (
        <div className="mt-8 space-y-4">
          {customers.map((customer) => (
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
                Durum: {customer.active ? "Aktif" : "Deaktif"}
              </p>

              <form
                action={updateCustomerActive}
                className="mt-3"
              >
                <input
                  type="hidden"
                  name="customerId"
                  value={customer.id}
                />

                <input
                  type="hidden"
                  name="active"
                  value={
                    customer.active ? "false" : "true"
                  }
                />

                <button
                  type="submit"
                  className="rounded-lg border border-zinc-700 px-4 py-2"
                >
                  {customer.active
                    ? "Deaktif et"
                    : "Aktif et"}
                </button>
              </form>

              <form
                action={updateCustomerPriceGroup}
                className="mt-4 flex items-center gap-3"
              >
                <input
                  type="hidden"
                  name="customerId"
                  value={customer.id}
                />

                <select
                  name="priceGroup"
                  defaultValue={customer.price_group}
                  className="rounded-lg border border-zinc-700 bg-black px-3 py-2"
                >
                  <option value="NORMAL">NORMAL</option>
                  <option value="DEALER">DEALER</option>
                  <option value="VIP">VIP</option>
                </select>

                <button
                  type="submit"
                  className="rounded-lg bg-white px-4 py-2 font-medium text-black"
                >
                  Fiyat Grubunu Kaydet
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}