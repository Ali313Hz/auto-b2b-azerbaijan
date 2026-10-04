"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
};

export default function SubmitButton({
  children,
  pendingText = "Gözləyin...",
  className = "btn btn-primary",
  disabled = false,
  name,
  value,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      {pending ? pendingText : children}
    </button>
  );
}
