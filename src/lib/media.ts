import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

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
