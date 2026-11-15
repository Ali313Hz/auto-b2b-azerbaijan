"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type SidebarCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
};

type Props = {
  // Categories only (no products), already in the admin's order.
  categories: SidebarCategory[];
  selectedSlug: string;
  // The other catalog filters, kept when a category is picked.
  linkParams: Record<string, string | undefined>;
};

type TreeProps = {
  categories: SidebarCategory[];
  selectedSlug: string;
  hrefFor: (slug: string) => string;
  onPick?: () => void;
};

// Same link format as pageHref (page 1 of the category).
function categoryLink(linkParams: Record<string, string | undefined>, slug: string) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...linkParams, category: slug || undefined })) {
    if (value) search.set(key, value);
  }

  const query = search.toString();

  return query ? `/products?${query}` : "/products";
}

// Desktop: a collapsible tree on the left. Phones: a "Kateqoriyalar" button
// that opens the same tree in a drawer, which closes after a pick.
export default function CategorySidebar({ categories, selectedSlug, linkParams }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hrefFor = (slug: string) => categoryLink(linkParams, slug);

  // Escape closes the drawer; the page behind does not scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    const overflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const selectedName = categories.find((category) => category.slug === selectedSlug)?.name;

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          className="btn btn-secondary w-full justify-between"
        >
          <span>☰ Kateqoriyalar</span>
          {selectedName && <span className="truncate text-amber-400">{selectedName}</span>}
        </button>
      </div>

      <aside aria-label="Kateqoriyalar" className="hidden lg:block">
        <div className="card sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto p-2">
          <CategoryTree
            categories={categories}
            selectedSlug={selectedSlug}
            hrefFor={hrefFor}
          />
        </div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Kateqoriyalar">
          <button
            type="button"
            aria-label="Bağla"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col border-r border-zinc-800 bg-zinc-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <p className="font-semibold text-white">Kateqoriyalar</p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="btn btn-secondary btn-sm"
                aria-label="Bağla"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <CategoryTree
                categories={categories}
                selectedSlug={selectedSlug}
                hrefFor={hrefFor}
                onPick={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CategoryTree({ categories, selectedSlug, hrefFor, onPick }: TreeProps) {
  const { childrenOf, ancestors } = useMemo(() => {
    const children = new Map<string | null, SidebarCategory[]>();
    const byId = new Map<string, SidebarCategory>();

    for (const category of categories) {
      byId.set(category.id, category);
      children.set(category.parent_id, [...(children.get(category.parent_id) ?? []), category]);
    }

    // The selected category and its parents start open.
    const open = new Set<string>();
    let node = categories.find((category) => category.slug === selectedSlug);

    while (node) {
      open.add(node.id);
      node = node.parent_id ? byId.get(node.parent_id) : undefined;
    }

    return { childrenOf: children, ancestors: open };
  }, [categories, selectedSlug]);

  // Branches the customer opened or closed by hand.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const isOpen = (id: string) => toggled.get(id) ?? ancestors.has(id);

  function toggle(id: string) {
    setToggled((current) => new Map(current).set(id, !isOpen(id)));
  }

  function renderLevel(parent: string | null, depth: number) {
    const items = childrenOf.get(parent) ?? [];

    if (items.length === 0) return null;

    return (
      <ul className={depth > 0 ? "ml-3 border-l border-zinc-800 pl-1" : ""}>
        {items.map((category) => {
          const hasChildren = childrenOf.has(category.id);
          const open = isOpen(category.id);
          const selected = category.slug === selectedSlug;

          return (
            <li key={category.id}>
              <div className="flex items-center gap-0.5">
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(category.id)}
                    aria-expanded={open}
                    aria-label={`${category.name}: ${open ? "bağla" : "aç"}`}
                    className="grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  >
                    {open ? "▾" : "▸"}
                  </button>
                ) : (
                  <span aria-hidden className="size-8 shrink-0" />
                )}
                <Link
                  href={hrefFor(category.slug)}
                  onClick={onPick}
                  aria-current={selected ? "page" : undefined}
                  className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-sm break-words ${
                    selected
                      ? "bg-amber-500 font-semibold text-zinc-950"
                      : depth === 0
                        ? "font-medium text-zinc-100 hover:bg-zinc-800"
                        : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  }`}
                >
                  {category.name}
                </Link>
              </div>
              {hasChildren && open && renderLevel(category.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav aria-label="Kateqoriya ağacı" className="space-y-1">
      <Link
        href={hrefFor("")}
        onClick={onPick}
        aria-current={!selectedSlug ? "page" : undefined}
        className={`block rounded-md px-3 py-2 text-sm font-semibold ${
          !selectedSlug ? "bg-amber-500 text-zinc-950" : "text-white hover:bg-zinc-800"
        }`}
      >
        Bütün kateqoriyalar
      </Link>
      {renderLevel(null, 0)}
    </nav>
  );
}
