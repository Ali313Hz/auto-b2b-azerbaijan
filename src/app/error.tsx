"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-white">
          Gözlənilməz xəta baş verdi
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          Zəhmət olmasa yenidən cəhd edin. Problem davam edərsə
          administratorla əlaqə saxlayın.
        </p>

        <button
          type="button"
          onClick={reset}
          className="btn btn-primary mt-6"
        >
          Yenidən cəhd et
        </button>
      </div>
    </main>
  );
}
