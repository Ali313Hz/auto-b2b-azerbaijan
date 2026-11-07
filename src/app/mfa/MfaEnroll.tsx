"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import CodeInput, { codeErrors, readCode } from "./CodeInput";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type MfaEnrollProps = {
  // First enrollment (login) or an extra backup device (security page).
  mode?: "required" | "backup";
};

export default function MfaEnroll({ mode = "required" }: MfaEnrollProps) {
  const router = useRouter();
  const started = useRef(false);

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard against the double effect run in development.
    if (started.current) {
      return;
    }

    started.current = true;

    void (async () => {
      const supabase = createClient();

      // Abandoned, never-verified enrollments would block a new one.
      const { data: factors } = await supabase.auth.mfa.listFactors();

      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Dostlar Auto",
        friendlyName: `Autentifikator ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      });

      if (enrollError || !data) {
        setLoadError(
          enrollError?.status === 429
            ? codeErrors.rateLimited
            : "Autentifikator qurulmadı. Səhifəni yeniləyin."
        );
        return;
      }

      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    })();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || !enrollment) {
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
      factorId: enrollment.factorId,
      code,
    });

    if (verifyError) {
      setError(verifyError.status === 429 ? codeErrors.rateLimited : codeErrors.invalid);
      setPending(false);
      return;
    }

    router.replace(mode === "required" ? "/" : "/security?notice=added");
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-white">
        {mode === "required" ? "Autentifikatoru qoşun" : "Ehtiyat cihaz əlavə edin"}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {mode === "required"
          ? "Hesabınızın təhlükəsizliyi üçün iki mərhələli təsdiq məcburidir."
          : "İkinci telefon və ya planşet əsas cihaz itdikdə giriş imkanını saxlayır."}
      </p>

      <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
        <li>Telefonda autentifikator tətbiqini açın (Google Authenticator, Microsoft Authenticator və s.).</li>
        <li>Aşağıdakı QR kodu skan edin.</li>
        <li>Tətbiqdə görünən 6 rəqəmli kodu daxil edin.</li>
      </ol>

      {loadError && (
        <p role="alert" className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200">
          {loadError}
        </p>
      )}

      {!enrollment && !loadError && (
        <div className="mt-5 grid h-48 place-items-center rounded-lg border border-zinc-800 text-sm text-zinc-500">
          QR kod hazırlanır...
        </div>
      )}

      {enrollment && (
        <>
          <div className="mt-5 flex justify-center rounded-lg bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="Autentifikator üçün QR kod" width={180} height={180} />
          </div>

          <details className="mt-3 text-sm text-zinc-400">
            <summary className="cursor-pointer">QR kodu skan edə bilmirsiniz?</summary>
            <p className="mt-2">Tətbiqə bu açarı əl ilə daxil edin:</p>
            <code className="mt-1 block rounded bg-zinc-900 p-2 font-mono text-xs break-all text-zinc-200">
              {enrollment.secret}
            </code>
          </details>

          {error && (
            <p role="alert" className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="enroll-code" className="label">
                Təsdiq kodu
              </label>
              <CodeInput id="enroll-code" disabled={pending} />
            </div>

            <button type="submit" disabled={pending} aria-busy={pending} className="btn btn-primary w-full py-2.5">
              {pending ? "Yoxlanılır..." : "Təsdiq et və davam et"}
            </button>
          </form>
        </>
      )}
    </>
  );
}
