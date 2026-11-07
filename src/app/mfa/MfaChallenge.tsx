"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import CodeInput, { codeErrors, readCode } from "./CodeInput";

type MfaChallengeProps = {
  factors: { id: string; name: string }[];
};

export default function MfaChallenge({ factors }: MfaChallengeProps) {
  const router = useRouter();

  const [factorId, setFactorId] = useState(factors[0].id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const code = readCode(event.currentTarget);

    if (!code) {
      setError(codeErrors.format);
      return;
    }

    setPending(true);
    setError(null);

    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (verifyError) {
      setError(verifyError.status === 429 ? codeErrors.rateLimited : codeErrors.invalid);
      setPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white">İki mərhələli təsdiq</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Autentifikator tətbiqində (Google Authenticator, Microsoft
        Authenticator və s.) göstərilən 6 rəqəmli kodu daxil edin.
      </p>

      {error && (
        <p role="alert" className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {factors.length > 1 && (
          <div>
            <label htmlFor="factor" className="label">
              Cihaz
            </label>
            <select
              id="factor"
              value={factorId}
              onChange={(event) => setFactorId(event.target.value)}
              className="input"
            >
              {factors.map((factor) => (
                <option key={factor.id} value={factor.id}>
                  {factor.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="mfa-code" className="label">
            Təsdiq kodu
          </label>
          <CodeInput id="mfa-code" disabled={pending} />
        </div>

        <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary w-full py-2.5">
          {pending ? "Yoxlanılır..." : "Təsdiq et"}
        </button>
      </form>

      <p className="mt-5 text-xs text-zinc-500">
        Telefonunuzu itirmisinizsə, administratorla əlaqə saxlayın. Kimliyiniz
        yoxlanıldıqdan sonra autentifikator sıfırlanır və yenisini qoşa
        bilərsiniz.
      </p>
    </>
  );
}
