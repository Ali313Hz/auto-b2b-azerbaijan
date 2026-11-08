"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { useTurnstile } from "@/components/useTurnstile";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/client";

import { changeOwnPassword } from "./actions";

type ChangePasswordFormProps = {
  email: string;
  mustChange: boolean;
  turnstileSiteKey?: string;
};

export default function ChangePasswordForm({
  email,
  mustChange,
  turnstileSiteKey,
}: ChangePasswordFormProps) {
  const router = useRouter();
  const turnstile = useTurnstile(turnstileSiteKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const current = String(formData.get("currentPassword") ?? "");
    const next = String(formData.get("newPassword") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    const problem = passwordProblem(next);

    if (!current) {
      setError("Cari şifrəni daxil edin.");
      return;
    }

    if (problem) {
      setError(problem);
      return;
    }

    if (next !== confirm) {
      setError("Yeni şifrələr eyni deyil.");
      return;
    }

    if (next === current) {
      setError("Yeni şifrə köhnə şifrədən fərqli olmalıdır.");
      return;
    }

    setPending(true);
    setError(null);

    const captchaToken = await turnstile.getToken();

    if (captchaToken === null) {
      turnstile.reset();
      setError("Təhlükəsizlik yoxlaması alınmadı. Yenidən cəhd edin.");
      setPending(false);
      return;
    }

    // Proves the current password with a fresh login (rate limited and
    // CAPTCHA-protected by Supabase Auth) before the change.
    const { error: signInError } = await createClient().auth.signInWithPassword({
      email,
      password: current,
      options: captchaToken ? { captchaToken } : undefined,
    });

    turnstile.reset();

    if (signInError) {
      setError(
        signInError.status === 429
          ? "Çox sayda cəhd edildi. Bir neçə dəqiqə sonra yenidən cəhd edin."
          : "Cari şifrə yanlışdır."
      );
      setPending(false);
      return;
    }

    const result = await changeOwnPassword(next, confirm);

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }

    form.reset();
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
        {/* Lets password managers attach the new password to this account. */}
        <input
          type="email"
          name="username"
          value={email}
          autoComplete="username"
          readOnly
          hidden
        />

        <div>
          <label htmlFor="currentPassword" className="label">
            {mustChange ? "Müvəqqəti şifrə" : "Cari şifrə"}
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="label">
            Yeni şifrə
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            aria-describedby="password-rule"
            className="input"
          />
          <p id="password-rule" className="mt-1 text-xs text-zinc-500">
            {PASSWORD_RULE_TEXT}
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="label">
            Yeni şifrə (təkrar)
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
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
          {pending ? "Yoxlanılır..." : "Şifrəni dəyiş"}
        </button>
      </form>
    </>
  );
}
