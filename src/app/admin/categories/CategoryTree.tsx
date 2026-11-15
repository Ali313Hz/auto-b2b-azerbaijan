"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";

import { Badge } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { categoryColor, categoryTint } from "@/lib/category-colors";
import { categoryPath } from "@/lib/format";

import { type MoveDirection, moveCategory } from "./actions";

export type TreeCategory = {
  id: string;
  name: string;
  parent_id: string | null;
  root_id: string;
  depth: number;
  path: string;
  active: boolean;
  available: boolean;
  product_count: number;
  color: string | null;
};

// Open branches are remembered in this browser (localStorage).
const STORAGE_KEY = "admin-category-tree-open";
const CHANGE_EVENT = "admin-category-tree-open-change";

function readOpen() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeOpen(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function writeOpen(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode: the tree still works, it is just not remembered.
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function parseOpen(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);

    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

const moveButtons: { direction: MoveDirection; label: string; text: string }[] = [
  { direction: "up", label: "Bir pillə yuxarı", text: "↑" },
  { direction: "down", label: "Bir pillə aşağı", text: "↓" },
  { direction: "top", label: "Ən yuxarı", text: "Ən yuxarı" },
  { direction: "bottom", label: "Ən aşağı", text: "Ən aşağı" },
];

export default function CategoryTree({
  categories,
  canReorder,
}: {
  categories: TreeCategory[];
  canReorder: boolean;
}) {
  const rawOpen = useSyncExternalStore(subscribeOpen, readOpen, () => "[]");
  const open = useMemo(() => parseOpen(rawOpen), [rawOpen]);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionResult>(null);
  const [, startTransition] = useTransition();

  // Children in display order (the list arrives in tree order).
  const { childrenOf, byId } = useMemo(() => {
    const children = new Map<string | null, TreeCategory[]>();
    const ids = new Map<string, TreeCategory>();

    for (const category of categories) {
      ids.set(category.id, category);
      children.set(category.parent_id, [...(children.get(category.parent_id) ?? []), category]);
    }

    return { childrenOf: children, byId: ids };
  }, [categories]);

  // Products in a category including every sub-category.
  const totals = useMemo(() => {
    const result = new Map<string, number>();

    // Deepest first, so children are counted before their parents.
    for (const category of [...categories].sort((a, b) => b.depth - a.depth)) {
      const own = Number(category.product_count);
      const fromChildren = (childrenOf.get(category.id) ?? []).reduce(
        (sum, child) => sum + (result.get(child.id) ?? 0),
        0
      );
      result.set(category.id, own + fromChildren);
    }

    return result;
  }, [categories, childrenOf]);

  const search = query.trim().toLocaleLowerCase("az");
  const matches = search
    ? categories.filter((category) => category.path.toLocaleLowerCase("az").includes(search))
    : [];

  useEffect(() => {
    if (focusId) {
      document.getElementById(`category-${focusId}`)?.scrollIntoView({ block: "center" });
    }
  }, [focusId]);

  function toggle(id: string) {
    const next = new Set(open);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    writeOpen(next);
  }

  function setAll(expand: boolean) {
    writeOpen(
      expand
        ? new Set(categories.filter((c) => childrenOf.has(c.id)).map((c) => c.id))
        : new Set()
    );
  }

  // Opens every ancestor so the category is visible in the tree.
  function showInTree(id: string) {
    const next = new Set(open);

    for (let node = byId.get(id); node?.parent_id; node = byId.get(node.parent_id)) {
      next.add(node.parent_id);
    }

    writeOpen(next);
    setQuery("");
    setFocusId(id);
  }

  function move(id: string, direction: MoveDirection) {
    setPendingId(id);
    setMessage(null);
    startTransition(async () => {
      const result = await moveCategory(id, direction);

      setPendingId(null);

      if (!result?.ok) {
        setMessage(result);
      }
    });
  }

  function renderNode(category: TreeCategory, index: number, siblings: number) {
    const children = childrenOf.get(category.id) ?? [];
    const isOpen = open.has(category.id);
    const total = totals.get(category.id) ?? 0;
    const color = categoryColor(category.root_id, category.color);
    const busy = pendingId === category.id;

    return (
      <li key={category.id} id={`category-${category.id}`}>
        <div
          className={`flex flex-col gap-2 border-l-4 py-2.5 pr-2 sm:flex-row sm:items-center sm:pr-3 ${
            focusId === category.id ? "bg-amber-500/10" : ""
          } ${category.depth === 1 ? "bg-zinc-900/60" : ""}`}
          style={{
            borderLeftColor: categoryTint(color, category.depth),
            paddingLeft: `${0.5 + Math.min(category.depth - 1, 6) * 1.25}rem`,
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {children.length > 0 ? (
              <button
                type="button"
                onClick={() => toggle(category.id)}
                aria-expanded={isOpen}
                aria-label={`${category.name}: ${isOpen ? "bağla" : "aç"}`}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-zinc-700 bg-zinc-800 text-xl leading-none font-bold text-white hover:border-amber-500 hover:text-amber-400"
              >
                {isOpen ? "−" : "+"}
              </button>
            ) : (
              <span aria-hidden className="size-9 shrink-0" />
            )}

            <span
              aria-hidden
              className={`shrink-0 rounded-full ${category.depth === 1 ? "size-3.5" : "size-2.5"}`}
              style={{ backgroundColor: categoryTint(color, category.depth) }}
            />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/admin/categories/${category.id}`}
                  className={`font-semibold break-words hover:text-amber-400 ${
                    category.depth === 1 ? "text-base text-white" : "text-sm text-zinc-100"
                  }`}
                >
                  {category.name}
                </Link>
                {!category.active && <Badge tone="red">Deaktiv</Badge>}
                {category.active && !category.available && (
                  <Badge tone="amber">Ana kateqoriya deaktivdir</Badge>
                )}
                {total === 0 && <Badge tone="amber">Boşdur</Badge>}
              </div>
              <p className="text-xs text-zinc-500">
                Məhsullar ({total})
                {children.length > 0 ? ` · ${children.length} alt kateqoriya` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pl-11 sm:pl-0">
            {canReorder &&
              moveButtons.map((button) => {
                const atStart = index === 0 && (button.direction === "up" || button.direction === "top");
                const atEnd =
                  index === siblings - 1 && (button.direction === "down" || button.direction === "bottom");

                return (
                  <button
                    key={button.direction}
                    type="button"
                    disabled={busy || atStart || atEnd}
                    onClick={() => move(category.id, button.direction)}
                    aria-label={`${category.name}: ${button.label}`}
                    title={button.label}
                    className={`btn btn-secondary btn-sm disabled:opacity-30 ${
                      button.text.length === 1 ? "w-9 px-0 text-base" : ""
                    }`}
                  >
                    {button.text}
                  </button>
                );
              })}
            <Link
              href={`/admin/products/new?category=${category.id}`}
              className="btn btn-primary btn-sm"
            >
              + Məhsul əlavə et
            </Link>
          </div>
        </div>

        {children.length > 0 && isOpen && (
          <ul className="divide-y divide-zinc-800/70">
            {children.map((child, childIndex) => renderNode(child, childIndex, children.length))}
          </ul>
        )}
      </li>
    );
  }

  const roots = childrenOf.get(null) ?? [];

  return (
    <section aria-label="Kateqoriya ağacı">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="category-search" className="sr-only">
          Kateqoriya axtar
        </label>
        <input
          id="category-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Kateqoriya axtar"
          className="input sm:max-w-md"
          autoComplete="off"
        />
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAll(true)}>
            Hamısını aç
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAll(false)}>
            Hamısını bağla
          </button>
        </div>
      </div>

      {message && !message.ok && (
        <p role="alert" className="mb-3 text-sm text-red-400">
          {message.message}
        </p>
      )}

      {search ? (
        matches.length === 0 ? (
          <p className="card p-4 text-sm text-zinc-400">Uyğun kateqoriya tapılmadı.</p>
        ) : (
          <ul className="card divide-y divide-zinc-800" aria-label="Axtarış nəticələri">
            {matches.map((category) => (
              <li
                key={category.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(category.root_id, category.color) }}
                  />
                  <Link
                    href={`/admin/categories/${category.id}`}
                    className="min-w-0 text-sm break-words text-zinc-100 hover:text-amber-400"
                  >
                    {categoryPath(category.path)}
                  </Link>
                  <span className="shrink-0 text-xs text-zinc-500">
                    ({totals.get(category.id) ?? 0})
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm shrink-0"
                  onClick={() => showInTree(category.id)}
                >
                  Ağacda göstər
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="card divide-y divide-zinc-800 overflow-hidden">
          {roots.map((root, index) => renderNode(root, index, roots.length))}
        </ul>
      )}
    </section>
  );
}
