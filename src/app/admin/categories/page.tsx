import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  createCategory,
  updateCategory,
} from "./actions";

export default async function AdminCategoriesPage() {
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

  const { data: categories, error } =
    await supabase.rpc("get_admin_categories");

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">
          Kategoriler
        </h1>

        <p className="mt-4 text-red-500">
          Kategoriler yüklenirken hata oluştu.
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">
        Kategoriler
      </h1>

      <form
        action={createCategory}
        className="mt-6 space-y-4 rounded-xl border border-zinc-800 p-5"
      >
        <h2 className="text-xl font-semibold">
          Yeni Kategori Ekle
        </h2>

        <div>
          <label className="block text-sm">
            Kategori adı
          </label>

          <input
            name="name"
            required
            className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Slug
          </label>

          <input
            name="slug"
            required
            placeholder="ornek-kategori"
            className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Sıralama
          </label>

          <input
            type="number"
            name="sortOrder"
            min="0"
            step="1"
            required
            defaultValue="0"
            className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm">
            Durum
          </label>

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
          className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
        >
          Kategori Oluştur
        </button>
      </form>

      {!categories || categories.length === 0 ? (
        <p className="mt-8">
          Kategori bulunamadı.
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {categories.map((category) => (
            <form
              key={category.id}
              action={updateCategory}
              className="space-y-4 rounded-xl border border-zinc-800 p-5"
            >
              <input
                type="hidden"
                name="categoryId"
                value={category.id}
              />

              <div>
                <label className="block text-sm">
                  Kategori adı
                </label>

                <input
                  name="name"
                  required
                  defaultValue={category.name}
                  className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm">
                  Slug
                </label>

                <input
                  name="slug"
                  required
                  defaultValue={category.slug}
                  className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm">
                  Sıralama
                </label>

                <input
                  type="number"
                  name="sortOrder"
                  min="0"
                  step="1"
                  required
                  defaultValue={category.sort_order}
                  className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm">
                  Durum
                </label>

                <select
                  name="active"
                  defaultValue={
                    category.active ? "true" : "false"
                  }
                  className="mt-1 rounded-lg border border-zinc-700 bg-black px-3 py-2"
                >
                  <option value="true">
                    Aktif
                  </option>
                  <option value="false">
                    Deaktif
                  </option>
                </select>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-white px-5 py-2 font-semibold text-black"
              >
                Kaydet
              </button>
            </form>
          ))}
        </div>
      )}
    </main>
  );
}