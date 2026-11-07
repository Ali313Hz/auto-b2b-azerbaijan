import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

// Signed URLs are short-lived; pages are rendered per request, so a new URL
// is issued whenever a page is viewed again.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// "<product>/<uuid>.jpg" -> "<product>/<uuid>-thumb.webp" (images only).
export function thumbnailPathFor(storagePath: string) {
  return /\.(jpg|png|webp)$/.test(storagePath)
    ? storagePath.replace(/\.(jpg|png|webp)$/, "-thumb.webp")
    : null;
}

// Signs many storage paths in one request instead of one call per file.
export async function signMediaPaths(
  supabase: SupabaseClient<Database>,
  paths: (string | null | undefined)[]
) {
  const uniquePaths = [
    ...new Set(paths.filter((path): path is string => Boolean(path))),
  ];

  const urls = new Map<string, string>();

  if (uniquePaths.length === 0) {
    return urls;
  }

  const { data } = await supabase.storage
    .from("product-media")
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);

  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) {
      urls.set(item.path, item.signedUrl);
    }
  }

  return urls;
}

// Catalog cards: the small thumbnail when it exists, otherwise the original.
// Still one signing request for the whole page (max 2 paths per product).
export async function signCardImages(
  supabase: SupabaseClient<Database>,
  paths: (string | null | undefined)[]
) {
  const originals = paths.filter((path): path is string => Boolean(path));
  const signed = await signMediaPaths(supabase, [
    ...originals,
    ...originals.map(thumbnailPathFor),
  ]);

  const urls = new Map<string, string>();

  for (const path of originals) {
    const thumbnail = thumbnailPathFor(path);
    const url = (thumbnail && signed.get(thumbnail)) || signed.get(path);

    if (url) urls.set(path, url);
  }

  return urls;
}
