"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import SubmitButton from "@/components/SubmitButton";
import type { PasswordResetResult } from "@/components/PasswordResetForm";
import { PASSWORD_RULE_TEXT } from "@/lib/password";
import { staffRoleLabels, staffRoles } from "@/lib/format";

import { createStaff } from "../actions";

export default function StaffCreateForm() {
  const [state, formAction] = useActionState<PasswordResetResult, FormData>(
    createStaff,
    null
  );
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const password = state?.ok ? state.temporaryPassword : undefined;

  if (password) {
    return (
      <div className="card max-w-xl p-5 sm:p-6" role="status">
        <p className="font-medium text-emerald-300">İşçi yaradıldı.</p>
        <p className="mt-3 text-sm text-zinc-300">Yeni müvəqqəti şifrə:</p>
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(password);
                setCopied(true);
              } catch {
                setVisible(true);
              }
            }}
          >
            {copied ? "Kopyalandı" : "Kopyala"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Bu şifrə yalnız indi göstərilir və 24 saat etibarlıdır. İşçi ilk
          girişdə öz şifrəsini təyin edəcək.
        </p>
        <Link href="/admin/staff" className="btn btn-secondary mt-5">
          İşçilər siyahısına qayıt
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="card max-w-xl space-y-4 p-5 sm:p-6">
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-400">
          {state.message}
        </p>
      )}

      <div>
        <label htmlFor="fullName" className="label">Ad, soyad *</label>
        <input id="fullName" name="fullName" required maxLength={100} className="input" />
      </div>

      <div>
        <label htmlFor="email" className="label">E-poçt *</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          className="input"
        />
      </div>

      <div>
        <label htmlFor="role" className="label">Rol *</label>
        <select id="role" name="role" defaultValue="SALES" className="input">
          {staffRoles.map((role) => (
            <option key={role} value={role}>
              {staffRoleLabels[role]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">İlk şifrə</legend>
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
          <label htmlFor="password" className="label">Müvəqqəti şifrə</label>
          <input
            id="password"
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

      <SubmitButton pendingText="Yaradılır...">İşçini yarat</SubmitButton>
    </form>
  );
}
