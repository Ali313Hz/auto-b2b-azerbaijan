import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

// Signed URLs are short-lived (1 hour).
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// The same file gets the same URL for a while, so the browser and the CDN
// can reuse the downloaded picture instead of fetching it again on every
// page view (a new URL every time made every picture a cache miss).
// A URL is handed out again only while it still has at least 25 minutes
// left. Paths come from the database functions the viewer is allowed to
// call, and storage lets every active account read product media, so
// reusing a URL for another viewer gives nobody access to a new file.
const REUSE_MIN_LEFT_MS = 25 * 60 * 1000;
const MAX_CACHED_URLS = 5000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
// Files that do not exist (e.g. no small thumbnail yet) are not asked for
// again for 5 minutes, so a page without thumbnails still needs no request.
const MISSING_RETRY_MS = 5 * 60 * 1000;
const missingUntil = new Map<string, number>();

function cachedUrl(path: string, now: number) {
  const entry = signedUrlCache.get(path);

  if (!entry) return null;

  if (entry.expiresAt - now < REUSE_MIN_LEFT_MS) {
    signedUrlCache.delete(path);
    return null;
  }

  return entry.url;
}

function rememberUrl(path: string, url: string, expiresAt: number) {
  if (signedUrlCache.size >= MAX_CACHED_URLS) {
    // Oldest entries first (Map keeps insertion order).
    const drop = signedUrlCache.size - MAX_CACHED_URLS + 1;
    let index = 0;

    for (const key of signedUrlCache.keys()) {
      if (index++ >= drop) break;
      signedUrlCache.delete(key);
    }
  }

  signedUrlCache.set(path, { url, expiresAt });
}

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
  const now = Date.now();
  const missing: string[] = [];

  for (const path of uniquePaths) {
    const url = cachedUrl(path, now);

    if (url) {
      urls.set(path, url);
    } else if ((missingUntil.get(path) ?? 0) <= now) {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    return urls;
  }

  const { data, error } = await supabase.storage
    .from("product-media")
    .createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
  // Counted from before the request, so the stored time is never too late.
  const expiresAt = now + SIGNED_URL_TTL_SECONDS * 1000;

  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) {
      urls.set(item.path, item.signedUrl);
      rememberUrl(item.path, item.signedUrl, expiresAt);
      missingUntil.delete(item.path);
    } else if (item.path && !error) {
      if (missingUntil.size >= MAX_CACHED_URLS) missingUntil.clear();
      missingUntil.set(item.path, now + MISSING_RETRY_MS);
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
