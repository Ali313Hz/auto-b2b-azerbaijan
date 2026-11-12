"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import { uuidPattern } from "@/lib/format";
import { thumbnailPathFor } from "@/lib/media";
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
  const parentValue = String(formData.get("parentId") ?? "");

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

  if (parentValue && !uuidPattern.test(parentValue)) {
    return { valid: false, error: "Ana kateqoriya yanlışdır." } as const;
  }

  return {
    valid: true,
    value: {
      name,
      slug,
      sortOrder,
      active: activeValue === "true",
      parentId: parentValue || null,
    },
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
  const autoSlug = !String(formData.get("slug") ?? "").trim();

  // The slug comes from the name. The same name can exist under different
  // parents (e.g. "Universal"), so a taken auto slug gets -2, -3, ...
  let error = null;

  for (let attempt = 1; attempt <= 20; attempt++) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const slug = `${parsed.value.slug.slice(0, 80 - suffix.length)}${suffix}`;

    ({ error } = await supabase.rpc("create_admin_category", {
      p_name: parsed.value.name,
      p_slug: slug,
      p_sort_order: parsed.value.sortOrder,
      p_active: parsed.value.active,
      p_parent_id: parsed.value.parentId,
    }));

    if (!error || !autoSlug || error.message !== "Category slug already exists") {
      break;
    }
  }

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
    p_parent_id: parsed.value.parentId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Kateqoriya yenilənmədi."));
  }

  revalidateCategoryPaths();

  return ok("Yadda saxlandı.");
}

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const maxImageSize = 5 * 1024 * 1024;
const maxThumbnailSize = 512 * 1024;

type Client = Awaited<ReturnType<typeof getAuthedClient>>;

// Removes an image and its small catalog copy from storage.
async function removeImageFiles(supabase: Client, path: string | null | undefined) {
  if (!path) {
    return true;
  }

  const { error } = await supabase.storage
    .from("product-media")
    .remove([path, thumbnailPathFor(path)].filter((item): item is string => Boolean(item)));

  return !error;
}

function readCategoryId(formData: FormData) {
  const value = formData.get("categoryId");

  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

// Uploads (or replaces) the image of a category (OWNER, PRODUCT_MANAGER;
// storage policies and the database check the role).
export async function uploadCategoryImage(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const categoryId = readCategoryId(formData);
  const image = formData.get("image");

  if (!categoryId) {
    return fail("Kateqoriya məlumatı yanlışdır.");
  }

  if (!(image instanceof File) || image.size === 0) {
    return fail("Şəkil seçin.");
  }

  const extension = imageExtensions[image.type];

  if (!extension) {
    return fail("Yalnız JPG, PNG və ya WEBP şəkil yükləmək olar.");
  }

  if (image.size > maxImageSize) {
    return fail("Şəklin həcmi 5 MB-dan çox ola bilməz.");
  }

  const supabase = await getAuthedClient();
  const storagePath = `categories/${categoryId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("product-media")
    .upload(storagePath, image, { contentType: image.type, upsert: false });

  if (uploadError) {
    return fail("Şəkil yaddaşa yüklənmədi.");
  }

  const thumbnail = formData.get("thumbnail");

  if (
    thumbnail instanceof File &&
    thumbnail.size > 0 &&
    thumbnail.size <= maxThumbnailSize &&
    thumbnail.type === "image/webp"
  ) {
    await supabase.storage
      .from("product-media")
      .upload(thumbnailPathFor(storagePath) as string, thumbnail, {
        contentType: "image/webp",
        upsert: false,
      });
  }

  const { data: oldPath, error } = await supabase.rpc("set_admin_category_image", {
    p_category_id: categoryId,
    p_image_path: storagePath,
  });

  if (error) {
    await removeImageFiles(supabase, storagePath);

    return fail(dbErrorMessage(error, "Şəkil kateqoriyaya bağlanmadı."));
  }

  await removeImageFiles(supabase, oldPath);
  revalidateCategoryPaths();

  return ok("Şəkil yükləndi.");
}

export async function removeCategoryImage(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const categoryId = readCategoryId(formData);

  if (!categoryId) {
    return fail("Kateqoriya məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { data: oldPath, error } = await supabase.rpc("set_admin_category_image", {
    p_category_id: categoryId,
    p_image_path: null,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Şəkil silinmədi."));
  }

  await removeImageFiles(supabase, oldPath);
  revalidateCategoryPaths();

  return ok("Şəkil silindi.");
}

// Only an empty category (no sub-categories, no products) can be deleted;
// the database checks this and refuses otherwise.
export async function deleteCategory(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const categoryId = readCategoryId(formData);

  if (!categoryId) {
    return fail("Kateqoriya məlumatı yanlışdır.");
  }

  const supabase = await getAuthedClient();

  const { data: imagePath, error } = await supabase.rpc("delete_admin_category", {
    p_category_id: categoryId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Kateqoriya silinmədi."));
  }

  await removeImageFiles(supabase, imagePath);
  revalidateCategoryPaths();

  return ok("Kateqoriya silindi.");
}
