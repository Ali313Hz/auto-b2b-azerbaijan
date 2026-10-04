"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const transliteration: Record<string, string> = {
  ə: "e",
  ı: "i",
  ö: "o",
  ü: "u",
  ş: "s",
  ç: "c",
  ğ: "g",
};

function slugify(value: string) {
  return value
    .toLocaleLowerCase("az")
    .replace(/[əıöüşçğ]/g, (char) => transliteration[char] ?? char)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseCategory(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const rawSlug = String(formData.get("slug") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder") ?? 0);
  const activeValue = formData.get("active");

  if (!name) {
    return { valid: false, error: "Kateqoriya adı mütləqdir." } as const;
  }

  const slug = slugify(rawSlug || name);

  if (!slug) {
    return {
      valid: false,
      error: "Slug yalnız latın hərfləri, rəqəmlər və tire ola bilər.",
    } as const;
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { valid: false, error: "Sıra 0 və ya daha böyük tam ədəd olmalıdır." } as const;
  }

  if (activeValue !== "true" && activeValue !== "false") {
    return { valid: false, error: "Status yanlışdır." } as const;
  }

  return {
    valid: true,
    value: { name, slug, sortOrder, active: activeValue === "true" },
  } as const;
}

async function getAuthedClient() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return supabase;
}

function revalidateCategoryPaths() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/cart");
}

export async function createCategory(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = parseCategory(formData);

  if (!parsed.valid) {
    return fail(parsed.error);
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("create_admin_category", {
    p_name: parsed.value.name,
    p_slug: parsed.value.slug,
    p_sort_order: parsed.value.sortOrder,
    p_active: parsed.value.active,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Kateqoriya yaradılmadı."));
  }

  revalidateCategoryPaths();

  return ok(`“${parsed.value.name}” kateqoriyası yaradıldı.`);
}

export async function updateCategory(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const categoryId = formData.get("categoryId");
  const parsed = parseCategory(formData);

  if (typeof categoryId !== "string" || !categoryId) {
    return fail("Kateqoriya məlumatı yanlışdır.");
  }

  if (!parsed.valid) {
    return fail(parsed.error);
  }

  const supabase = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_category", {
    p_category_id: categoryId,
    p_name: parsed.value.name,
    p_slug: parsed.value.slug,
    p_sort_order: parsed.value.sortOrder,
    p_active: parsed.value.active,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Kateqoriya yenilənmədi."));
  }

  revalidateCategoryPaths();

  return ok("Yadda saxlandı.");
}
