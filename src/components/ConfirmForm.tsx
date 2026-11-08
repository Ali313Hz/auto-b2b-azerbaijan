"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/lib/action-result";

type Tone = "primary" | "success" | "danger" | "secondary";

const toneClass: Record<Tone, string> = {
  primary: "btn btn-primary",
  success: "btn btn-success",
  danger: "btn btn-danger",
  secondary: "btn btn-secondary",
};

type ConfirmFormProps = {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  // Hidden form fields sent with the action.
  fields: Record<string, string>;
  label: string;
  question: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingText?: string;
  tone?: Tone;
  className?: string;
};

// Critical action with an in-page confirmation step. Native dialogs
// (window.confirm) are not used: they can be blocked and then silently
// return false. The confirm button is disabled while the action runs, so a
// double click cannot submit twice.
export default function ConfirmForm({
  action,
  fields,
  label,
  question,
  description,
  confirmLabel = "Təsdiqlə",
  cancelLabel = "İmtina",
  pendingText = "Gözləyin...",
  tone = "primary",
  className = "",
}: ConfirmFormProps) {
  const [state, formAction, pending] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const [handledState, setHandledState] = useState(state);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // A finished action closes the confirmation.
  if (state !== handledState) {
    setHandledState(state);
    setAsking(false);
  }

  useEffect(() => {
    if (asking) {
      confirmRef.current?.focus();
    }
  }, [asking]);

  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {!asking ? (
        <button
          type="button"
          className={`${toneClass[tone]} w-full`}
          disabled={pending}
          onClick={() => setAsking(true)}
        >
          {pending ? pendingText : label}
        </button>
      ) : (
        <div
          role="alertdialog"
          aria-label={question}
          className={`rounded-lg border p-3 ${
            tone === "danger"
              ? "border-red-800/70 bg-red-950/30"
              : "border-zinc-700 bg-zinc-900"
          }`}
        >
          <p className="text-sm font-medium text-white">{question}</p>
          {description && (
            <p className="mt-1 text-xs text-zinc-400">{description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              className={`${toneClass[tone === "secondary" ? "primary" : tone]} flex-1`}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? pendingText : confirmLabel}
            </button>
          </div>
        </div>
      )}

      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
