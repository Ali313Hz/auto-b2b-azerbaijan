"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useTurnstile } from "@/components/useTurnstile";
import { createClient } from "@/lib/supabase/client";

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
  const turnstile = useTurnstile(turnstileSiteKey);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (errorMessages[errorCode] ?? GENERIC_ERROR) : null
  );

  // A deactivated account or a session from before a password change must
  // not keep a half-open session in this browser.
  useEffect(() => {
    if (errorCode === "inactive" || errorCode === "session") {
      void createClient().auth.signOut({ scope: "local" });
    }
  }, [errorCode]);

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

    setPending(true);
    setError(null);

    const captchaToken = await turnstile.getToken();

    if (captchaToken === null) {
      setError("Təhlükəsizlik yoxlaması alınmadı. Yenidən cəhd edin.");
      turnstile.reset();
      setPending(false);
      return;
    }

    const { error: signInError } = await createClient().auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (signInError) {
      turnstile.reset();
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

    // The home page sends the user to the shop, the admin panel or, with a
    // temporary password, to the change-password page.
    router.replace("/");
    router.refresh();
  }

  return (
    <>
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

        {turnstile.widget}

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
