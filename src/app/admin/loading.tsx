export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-zinc-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card h-72" />
        ))}
      </div>
      <span className="sr-only">Yüklənir...</span>
    </div>
  );
}
