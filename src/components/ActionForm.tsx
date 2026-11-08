"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import type { ActionResult } from "@/lib/action-result";

type ActionFormProps = {
  action: (
    state: ActionResult,
    formData: FormData
  ) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirmMessage?: string;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
};

/**
 * Form wrapper for server actions.
 *
 * When `confirmMessage` is set, the first submit does not run the action:
 * it shows the message inline with "Təsdiq et" / "Ləğv et" buttons, and the
 * action only runs after an explicit click on "Təsdiq et". This deliberately
 * avoids `window.confirm`, which some browsers/embedded views block (returning
 * false immediately), which would make the form silently never submit.
 */
export default function ActionForm({
  action,
  children,
  className,
  confirmMessage,
  resetOnSuccess = false,
  hideSuccess = false,
}: ActionFormProps) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  // Button that triggered the pending submit, so its name/value is preserved.
  const submitterRef = useRef<HTMLElement | null>(null);
  // Set right before the confirmed re-submit so onSubmit lets it through.
  const confirmedRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const messageId = useId();

  useEffect(() => {
    if (state?.ok && resetOnSuccess) {
      formRef.current?.reset();
    }
  }, [state, resetOnSuccess]);

  useEffect(() => {
    if (confirming) {
      confirmButtonRef.current?.focus();
    }
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    const submitter = submitterRef.current;
    submitterRef.current = null;
    if (submitter?.isConnected) {
      submitter.focus();
    }
  }

  function confirm() {
    const form = formRef.current;
    if (!form) return;

    const submitter = submitterRef.current;
    submitterRef.current = null;
    setConfirming(false);
    confirmedRef.current = true;

    if (submitter?.isConnected && submitter.getAttribute("type") !== "button") {
      form.requestSubmit(submitter);
    } else {
      form.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (!confirmMessage) return;

        if (confirmedRef.current) {
          confirmedRef.current = false;
          return;
        }

        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter) {
          submitterRef.current = submitter;
        }
        setConfirming(true);
      }}
    >
      {children}

      {confirming && confirmMessage && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-label="Təsdiq"
          aria-describedby={messageId}
          className="mt-2 basis-full rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <p
            id={messageId}
            className="whitespace-pre-line text-sm text-amber-100"
          >
            {confirmMessage}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={confirmButtonRef}
              type="button"
              className="btn btn-danger btn-sm"
              onClick={confirm}
            >
              Təsdiq et
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={cancel}
            >
              Ləğv et
            </button>
          </div>
        </div>
      )}

      {state && !(state.ok && hideSuccess) && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 basis-full text-sm ${
            state.ok ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
