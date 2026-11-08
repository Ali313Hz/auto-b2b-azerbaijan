import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/ui";
import { getSession } from "@/lib/auth";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Daxil ol",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const errorCode =
    typeof params.error === "string" ? params.error : undefined;

  if (!errorCode) {
    const { user } = await getSession();

    if (user) {
      redirect("/");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-white">
            B2B hesabınıza daxil olun
          </h1>

          <p className="mt-1 text-sm text-zinc-400">
            Avtomobil aksesuarları üzrə topdan sifariş platforması
          </p>

          <LoginForm
            errorCode={errorCode}
            turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}
          />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Hesab yalnız administrator tərəfindən yaradılır.
        </p>
      </div>
    </main>
  );
}
