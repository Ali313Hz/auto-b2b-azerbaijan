import Link from "next/link";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  // Current filters, kept in every page link.
  params: Record<string, string | undefined>;
};

export function pageHref(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number
) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  if (page > 1) search.set("page", String(page));

  const query = search.toString();

  return query ? `${basePath}?${query}` : basePath;
}

export default function Pagination({ page, pageSize, total, basePath, params }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (pages <= 1) {
    return null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Səhifələr"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400"
    >
      <p>
        {from}–{to} / {total}
      </p>

      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={pageHref(basePath, params, page - 1)} className="btn btn-secondary btn-sm" rel="prev">
            ← Əvvəlki
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm pointer-events-none opacity-40">← Əvvəlki</span>
        )}

        <span className="px-2 text-zinc-300">
          {Math.min(page, pages)} / {pages}
        </span>

        {page < pages ? (
          <Link href={pageHref(basePath, params, page + 1)} className="btn btn-secondary btn-sm" rel="next">
            Növbəti →
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm pointer-events-none opacity-40">Növbəti →</span>
        )}
      </div>
    </nav>
  );
}
