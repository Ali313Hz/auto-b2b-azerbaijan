import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import DeleteCustomerButton from "./DeleteCustomerButton";

import {
  archiveCustomer,
  createCustomer,
  restoreCustomer,
  updateCustomerActive,
  updateCustomerLogin,
  updateCustomerPriceGroup,
  updateCustomerProfile,
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
      <h1 className="text-3xl font-semibold">Müşteriler</h1>

      <div className="mt-8 rounded-xl border border-zinc-800 p-6">
        <h2 className="text-2xl font-semibold">
          Yeni Müşteri Ekle
        </h2>

        <form action={createCustomer} className="mt-6 space-y-5">
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
            <label className="block text-sm">Şirket adı</label>

            <input
              name="companyName"
              required
              className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm">Yetkili kişi</label>

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
            <label className="block text-sm">Fiyat grubu</label>

            <select
              name="priceGroup"
              defaultValue="NORMAL"
              className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
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
              className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
            >
              <option value="true">Aktif</option>
              <option value="false">Deaktif</option>
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-white px-5 py-3 font-semibold text-black"
          >
            Müşteri Oluştur
          </button>
        </form>
      </div>

      {!customers || customers.length === 0 ? (
        <p className="mt-8">Müşteri bulunamadı.</p>
      ) : (
        <div className="mt-8 space-y-6">
          {customers.map((customer) => {
            const isArchived = customer.archived_at !== null;

            return (
              <div
                key={customer.id}
                className="rounded-xl border border-zinc-800 p-6"
              >
                {isArchived && (
                  <div className="mb-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
                    <p className="font-semibold text-amber-300">
                      Arşivlenmiş müşteri
                    </p>

                    <p className="mt-1 text-sm text-zinc-400">
                      Bu müşteri giriş yapamaz ve aktif hale
                      getirilemez.
                    </p>
                  </div>
                )}
<div className="mb-6 rounded-lg border border-zinc-800 p-4">
  <p className="text-sm text-zinc-400">
    E-posta
  </p>

  <p className="mt-1 font-medium">
    {customer.email}
  </p>

  <p className="mt-2 text-sm text-zinc-400">
    Sipariş sayısı: {customer.order_count}
  </p>
</div>
                <form
                  action={updateCustomerProfile}
                  className="space-y-4"
                >
                  <input
                    type="hidden"
                    name="customerId"
                    value={customer.id}
                  />

                  <div>
                    <label className="block text-sm">
                      Şirket adı
                    </label>

                    <input
                      name="companyName"
                      required
                      disabled={isArchived}
                      defaultValue={customer.company_name ?? ""}
                      className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm">
                      Yetkili kişi
                    </label>

                    <input
                      name="contactName"
                      required
                      disabled={isArchived}
                      defaultValue={customer.contact_name ?? ""}
                      className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm">
                      Telefon
                    </label>

                    <input
                      type="tel"
                      name="phone"
                      disabled={isArchived}
                      defaultValue={customer.phone ?? ""}
                      className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2 disabled:opacity-50"
                    />
                  </div>

                  {!isArchived && (
                    <button
                      type="submit"
                      className="rounded-lg bg-white px-4 py-2 font-medium text-black"
                    >
                      Bilgileri Kaydet
                    </button>
                  )}
                </form>

                {!isArchived && (
                  <form
                    action={updateCustomerLogin}
                    className="mt-6 space-y-4 border-t border-zinc-800 pt-5"
                  >
                    <input
                      type="hidden"
                      name="customerId"
                      value={customer.id}
                    />

                    <h3 className="font-semibold">
                      Giriş Bilgileri
                    </h3>
                    <p className="text-sm text-zinc-400">
  Mevcut e-posta: {customer.email}
</p>

                    <div>
                      <label className="block text-sm">
                        Yeni e-posta
                      </label>

                      <input
                        type="email"
                        name="email"
                        placeholder="Değişmeyecekse boş bırak"
                        autoComplete="off"
                        className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm">
                        Yeni şifre
                      </label>

                      <input
                        type="password"
                        name="password"
                        minLength={8}
                        placeholder="Değişmeyecekse boş bırak"
                        autoComplete="new-password"
                        className="mt-1 block rounded-lg border border-zinc-700 bg-black px-3 py-2"
                      />

                      <p className="mt-1 text-xs text-zinc-400">
                        Yeni şifre girilecekse en az 8 karakter
                        olmalıdır.
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="rounded-lg border border-zinc-700 px-4 py-2"
                    >
                      Giriş Bilgilerini Güncelle
                    </button>
                  </form>
                )}

                <div className="mt-6 border-t border-zinc-800 pt-5">
                  <p>
                    Durum:{" "}
                    {isArchived
                      ? "Arşivde"
                      : customer.active
                        ? "Aktif"
                        : "Deaktif"}
                  </p>

                  {!isArchived && (
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
                  )}
                </div>

                {!isArchived && (
                  <form
                    action={updateCustomerPriceGroup}
                    className="mt-5 flex flex-wrap items-end gap-3"
                  >
                    <input
                      type="hidden"
                      name="customerId"
                      value={customer.id}
                    />

                    <div>
                      <label className="block text-sm">
                        Fiyat grubu
                      </label>

                      <select
                        name="priceGroup"
                        defaultValue={customer.price_group}
                        className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                      >
                        <option value="NORMAL">NORMAL</option>
                        <option value="DEALER">DEALER</option>
                        <option value="VIP">VIP</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="rounded-lg bg-white px-4 py-2 font-medium text-black"
                    >
                      Fiyat Grubunu Kaydet
                    </button>
                  </form>
                )}

                <div className="mt-6 border-t border-zinc-800 pt-5">


                  {isArchived ? (
  <div>
    <form action={restoreCustomer}>
      <input
        type="hidden"
        name="customerId"
        value={customer.id}
      />

      <button
        type="submit"
        className="rounded-lg border border-emerald-800 px-4 py-2 text-emerald-400"
      >
        Arşivden Çıkar
      </button>
    </form>

    {customer.can_permanently_delete && (
      <div className="mt-3">
        <DeleteCustomerButton
          customerId={customer.id}
          companyName={customer.company_name}
        />
      </div>
    )}
  </div>
) : (



                    <form action={archiveCustomer}>
                      <input
                        type="hidden"
                        name="customerId"
                        value={customer.id}
                      />

                      <button
                        type="submit"
                        className="rounded-lg border border-amber-800 px-4 py-2 text-amber-400"
                      >
                        Müşteriyi Arşivle
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}