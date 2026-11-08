"use client";

import { useActionState, useState } from "react";

import SubmitButton from "@/components/SubmitButton";
import { PASSWORD_RULE_TEXT } from "@/lib/password";

export type PasswordResetResult = {
  ok: boolean;
  message: string;
  // Only in the response to the OWNER's own reset request. Never stored,
  // logged or put in a URL; it disappears on reload.
  temporaryPassword?: string;
} | null;

type PasswordResetFormProps = {
  action: (
    state: PasswordResetResult,
    formData: FormData
  ) => Promise<PasswordResetResult>;
  idName: string;
  idValue: string;
  confirmMessage: string;
  submitLabel?: string;
};

export default function PasswordResetForm({
  action,
  idName,
  idValue,
  confirmMessage,
  submitLabel = "Şifrəni sıfırla",
}: PasswordResetFormProps) {
  const [state, formAction] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handledState, setHandledState] = useState(state);

  const password = state?.ok ? state.temporaryPassword : undefined;

  // After a successful reset: close the form, start masked.
  if (state !== handledState) {
    setHandledState(state);

    if (state?.ok) {
      setOpen(false);
      setVisible(false);
      setCopied(false);
    }
  }

  async function copy() {
    if (!password) return;

    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setVisible(true);
    }
  }

  return (
    <div>
      {password && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-4"
        >
          <p className="text-sm font-medium text-emerald-200">
            Yeni müvəqqəti şifrə:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-zinc-900 px-3 py-1.5 font-mono text-base text-white select-all">
              {visible ? password : "•".repeat(password.length)}
            </code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? "Gizlət" : "Göstər"}
            </button>
            <button type="button" className="btn btn-primary" onClick={copy}>
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Bu şifrə yalnız indi göstərilir və 24 saat etibarlıdır. İstifadəçi
            ilk girişdə öz şifrəsini təyin edəcək. Şifrəni təhlükəsiz kanalla
            çatdırın.
          </p>
        </div>
      )}

      {state && !state.ok && (
        <p role="alert" className="mb-3 text-sm text-red-400">
          {state.message}
        </p>
      )}

      {state?.ok && !password && (
        <p role="status" className="mb-3 text-sm text-emerald-400">
          {state.message}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(true)}
        >
          {submitLabel}
        </button>
      ) : (
        <form
          action={formAction}
          className="space-y-3 rounded-lg border border-zinc-800 p-4"
          onSubmit={(event) => {
            if (!window.confirm(confirmMessage)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name={idName} value={idValue} />

          <fieldset className="space-y-2">
            <legend className="sr-only">Şifrə növü</legend>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="radio"
                name="mode"
                value="generate"
                checked={mode === "generate"}
                onChange={() => setMode("generate")}
              />
              Təhlükəsiz şifrə yarat
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="radio"
                name="mode"
                value="manual"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
              />
              Şifrəni özüm yazım
            </label>
          </fieldset>

          {mode === "manual" && (
            <div>
              <label htmlFor={`${idName}-password`} className="label">
                Müvəqqəti şifrə
              </label>
              <input
                id={`${idName}-password`}
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={72}
                autoComplete="new-password"
                className="input"
              />
              <p className="mt-1 text-xs text-zinc-500">{PASSWORD_RULE_TEXT}</p>
            </div>
          )}

          <p className="text-xs text-zinc-500">
            Köhnə sessiyalar dərhal etibarsız olur. İstifadəçi 24 saat ərzində
            müvəqqəti şifrə ilə daxil olub yeni şifrə təyin etməlidir.
          </p>

          <div className="flex flex-wrap gap-2">
            <SubmitButton className="btn btn-danger" pendingText="Sıfırlanır...">
              {submitLabel}
            </SubmitButton>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setOpen(false)}
            >
              Ləğv et
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
