import type { BadgeTone } from "@/lib/format";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
  green: "border-emerald-700/60 bg-emerald-950/60 text-emerald-300",
  amber: "border-amber-700/60 bg-amber-950/60 text-amber-300",
  red: "border-red-800/60 bg-red-950/60 text-red-300",
  blue: "border-sky-700/60 bg-sky-950/60 text-sky-300",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>

        {description && (
          <p className="mt-1 text-sm text-zinc-400">{description}</p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <p className="text-lg font-medium text-zinc-200">{title}</p>

      {description && (
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "red",
  children,
}: {
  tone?: "red" | "green" | "amber";
  children: React.ReactNode;
}) {
  const tones = {
    red: "border-red-800/60 bg-red-950/40 text-red-200",
    green: "border-emerald-800/60 bg-emerald-950/40 text-emerald-200",
    amber: "border-amber-800/60 bg-amber-950/40 text-amber-200",
  };

  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>

      {children}

      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-amber-500 text-sm font-black text-zinc-950">
        DA
      </span>
      <span className="text-base font-bold uppercase tracking-wide text-white">
        Dostlar <span className="text-amber-500">Auto</span>
      </span>
    </span>
  );
}
