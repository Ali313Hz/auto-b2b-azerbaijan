import type { Metadata } from "next";

import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/ui";

import { login } from "./actions";

export const metadata: Metadata = {
  title: "Daxil ol",
};

const errorMessages: Record<string, string> = {
  inactive: "Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.",
  invalid: "E-poçt və ya şifrə yanlışdır.",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const errorCode =
    typeof params.error === "string" ? params.error : undefined;

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

          {errorCode && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200"
            >
              {errorMessages[errorCode] ?? errorMessages.invalid}
            </p>
          )}

          <form action={login} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="label">
                E-poçt
              </label>

              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="input"
              />
            </div>

            <div>
              <label htmlFor="password" className="label">
                Şifrə
              </label>

              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </div>

            <SubmitButton
              className="btn btn-primary w-full py-2.5"
              pendingText="Yoxlanılır..."
            >
              Daxil ol
            </SubmitButton>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Hesab yalnız administrator tərəfindən yaradılır.
        </p>
      </div>
    </main>
  );
}
