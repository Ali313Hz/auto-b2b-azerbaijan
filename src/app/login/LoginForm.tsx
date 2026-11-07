"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Turnstile = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme?: "dark" | "light" | "auto";
      language?: string;
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const GENERIC_ERROR = "E-poçt və ya şifrə yanlışdır.";

const errorMessages: Record<string, string> = {
  inactive: "Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.",
  invalid: GENERIC_ERROR,
  session: "Sessiya bitib. Yenidən daxil olun.",
};

type LoginFormProps = {
  errorCode?: string;
  turnstileSiteKey?: string;
};

// Signs in from the browser so Supabase Auth rate limits and CAPTCHA see the
// real client IP. Error messages never reveal whether an e-mail exists.
export default function LoginForm({ errorCode, turnstileSiteKey }: LoginFormProps) {
  const router = useRouter();
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (errorMessages[errorCode] ?? GENERIC_ERROR) : null
  );
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // A deactivated or expired account must not keep a half-open session.
  useEffect(() => {
    if (errorCode === "inactive" || errorCode === "session") {
      void createClient().auth.signOut();
    }
  }, [errorCode]);

  useEffect(() => {
    if (!turnstileSiteKey || !scriptReady || !widgetRef.current || widgetId.current) {
      return;
    }

    widgetId.current =
      window.turnstile?.render(widgetRef.current, {
        sitekey: turnstileSiteKey,
        theme: "dark",
        language: "az",
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
      }) ?? null;
  }, [turnstileSiteKey, scriptReady]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError(GENERIC_ERROR);
      return;
    }

    if (turnstileSiteKey && !captchaToken) {
      setError("Təhlükəsizlik yoxlamasını tamamlayın.");
      return;
    }

    setPending(true);
    setError(null);

    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (signInError) {
      // A CAPTCHA token is single-use.
      if (turnstileSiteKey) {
        window.turnstile?.reset(widgetId.current ?? undefined);
        setCaptchaToken(null);
      }

      setError(
        signInError.status === 429
          ? "Çox sayda cəhd edildi. Bir neçə dəqiqə sonra yenidən cəhd edin."
          : signInError.code?.startsWith("captcha")
            ? "Təhlükəsizlik yoxlaması alınmadı. Yenidən cəhd edin."
            : GENERIC_ERROR
      );
      setPending(false);
      return;
    }

    // Password accepted; the second factor is required before anything else.
    router.replace("/mfa");
    router.refresh();
  }

  return (
    <>
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
        />
      )}

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="label">
            E-poçt
          </label>

          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
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
            maxLength={128}
            autoComplete="current-password"
            className="input"
          />
        </div>

        {turnstileSiteKey && <div ref={widgetRef} className="min-h-[65px]" />}

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="btn btn-primary w-full py-2.5"
        >
          {pending ? "Yoxlanılır..." : "Daxil ol"}
        </button>
      </form>
    </>
  );
}
