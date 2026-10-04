import Link from "next/link";

import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>

        <h1 className="mt-6 text-xl font-semibold text-white">
          Səhifə tapılmadı
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          Axtardığınız səhifə mövcud deyil və ya sizin üçün əlçatan deyil.
        </p>

        <Link href="/" className="btn btn-primary mt-6">
          Ana səhifəyə qayıt
        </Link>
      </div>
    </main>
  );
}
