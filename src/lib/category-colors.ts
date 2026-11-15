// Accent colours of main categories. Only used as a small dot / left
// border next to white text on the dark background, so every colour is a
// light (400) shade that stays visible on zinc-950.
export const categoryPalette = [
  { value: "#f59e0b", label: "Narıncı" },
  { value: "#38bdf8", label: "Mavi" },
  { value: "#34d399", label: "Yaşıl" },
  { value: "#f472b6", label: "Çəhrayı" },
  { value: "#a78bfa", label: "Bənövşəyi" },
  { value: "#fb923c", label: "Portağalı" },
  { value: "#2dd4bf", label: "Firuzəyi" },
  { value: "#facc15", label: "Sarı" },
  { value: "#60a5fa", label: "Göy" },
  { value: "#f87171", label: "Qırmızı" },
] as const;

const colorPattern = /^#[0-9a-f]{6}$/;

// Stored colour of the main category, or an automatic one that depends on
// its id only (so it does not change when categories are reordered).
export function categoryColor(rootId: string, stored: string | null | undefined) {
  if (stored && colorPattern.test(stored)) {
    return stored;
  }

  let hash = 0;

  for (const char of rootId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return categoryPalette[hash % categoryPalette.length].value;
}

// Lighter tint for sub-categories: the same colour, more transparent the
// deeper the category is.
export function categoryTint(color: string, depth: number) {
  if (depth <= 1) {
    return color;
  }

  const alpha = Math.max(0.3, 0.75 - (depth - 2) * 0.15);

  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export function isCategoryColor(value: string) {
  return colorPattern.test(value);
}
