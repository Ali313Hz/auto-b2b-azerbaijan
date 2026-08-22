"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function createCategory(formData: FormData) {
  const nameValue = formData.get("name");
  const slugValue = formData.get("slug");
  const sortOrderValue = formData.get("sortOrder");
  const activeValue = formData.get("active");

  if (
    typeof nameValue !== "string" ||
    typeof slugValue !== "string" ||
    typeof sortOrderValue !== "string" ||
    typeof activeValue !== "string"
  ) {
    throw new Error("Geçersiz kategori bilgisi.");
  }

  if (activeValue !== "true" && activeValue !== "false") {
    throw new Error("Geçersiz kategori durumu.");
  }

  const name = nameValue.trim();
  const slug = slugValue.trim();
  const sortOrder = Number(sortOrderValue);
  const active = activeValue === "true";

  if (
    !name ||
    !slug ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0
  ) {
    throw new Error("Kategori bilgileri geçersiz.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "create_admin_category",
    {
      p_name: name,
      p_slug: slug,
      p_sort_order: sortOrder,
      p_active: active,
    }
  );

  if (error) {
    throw new Error("Kategori oluşturulamadı.");
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  revalidatePath("/products");
}

export async function updateCategory(formData: FormData) {
  const categoryId = formData.get("categoryId");
  const nameValue = formData.get("name");
  const slugValue = formData.get("slug");
  const sortOrderValue = formData.get("sortOrder");
  const activeValue = formData.get("active");

  if (
    typeof categoryId !== "string" ||
    typeof nameValue !== "string" ||
    typeof slugValue !== "string" ||
    typeof sortOrderValue !== "string" ||
    typeof activeValue !== "string"
  ) {
    throw new Error("Geçersiz kategori bilgisi.");
  }

  if (activeValue !== "true" && activeValue !== "false") {
    throw new Error("Geçersiz kategori durumu.");
  }

  const name = nameValue.trim();
  const slug = slugValue.trim();
  const sortOrder = Number(sortOrderValue);
  const active = activeValue === "true";

  if (
    !categoryId ||
    !name ||
    !slug ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0
  ) {
    throw new Error("Kategori bilgileri geçersiz.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "update_admin_category",
    {
      p_category_id: categoryId,
      p_name: name,
      p_slug: slug,
      p_sort_order: sortOrder,
      p_active: active,
    }
  );

  if (error) {
    throw new Error("Kategori güncellenemedi.");
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  revalidatePath("/products");
}