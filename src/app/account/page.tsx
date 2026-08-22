import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";

export default async function AccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("customer_profiles")
    .select("company_name, contact_name, price_group, active")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Profil tapılmadı</h1>
      </main>
    );
  }
  if (!profile.active) {
  redirect("/login?error=inactive");
}

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Müştəri hesabı</h1>

      <div className="mt-6 space-y-2">
        <p>Şirkət: {profile.company_name ?? "-"}</p>
        <p>Ad: {profile.contact_name ?? "-"}</p>
        <p>Qiymət qrupu: {profile.price_group}</p>
        <p>Status: {profile.active ? "Aktiv" : "Deaktiv"}</p>
      </div>

      <form action={logout} className="mt-8">
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-white"
        >
          Çıxış
        </button>
      </form>
    </main>
  );
}