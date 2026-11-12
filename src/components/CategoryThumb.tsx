// Category picture: the uploaded image, or a calm placeholder with the
// first letter of the name, so cards with and without images look alike.
export default function CategoryThumb({
  url,
  name,
  className = "",
  letterClassName = "text-3xl",
  eager = false,
}: {
  url?: string | null;
  name: string;
  className?: string;
  letterClassName?: string;
  eager?: boolean;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`bg-zinc-950 object-cover ${className}`}
      />
    );
  }

  const letter = name.trim().charAt(0).toLocaleUpperCase("az") || "?";

  return (
    <span
      aria-hidden
      className={`grid place-items-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-amber-950/60 ${className}`}
    >
      <span className={`font-bold text-amber-400/80 ${letterClassName}`}>{letter}</span>
    </span>
  );
}
