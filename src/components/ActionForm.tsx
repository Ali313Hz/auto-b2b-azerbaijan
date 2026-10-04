"use client";

import { useActionState, useEffect, useRef } from "react";

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

  useEffect(() => {
    if (state?.ok && resetOnSuccess) {
      formRef.current?.reset();
    }
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}

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
