import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import PasswordResetForm from "@/components/PasswordResetForm";
import SubmitButton from "@/components/SubmitButton";
import { Badge, Field, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { formatDate, isPast, staffRoleLabels, staffRoles } from "@/lib/format";

import { changeStaffEmail, resetStaffPassword, updateStaff } from "../actions";

export const metadata: Metadata = {
  title: "İşçi",
};

export default async function AdminStaffDetailPage({
  params,
}: PageProps<"/admin/staff/[id]">) {
  const { id } = await params;
  const { supabase, user } = await requireOwner();

  const { data: staff } = await supabase.rpc("get_admin_staff");
  const member = staff?.find((item) => item.id === id);

  if (!member) {
    notFound();
  }

  const isSelf = member.id === user.id;
  const tempExpired =
    member.must_change_password && isPast(member.temporary_password_expires_at);

  return (
    <>
      <Link
        href="/admin/staff"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← İşçilər
      </Link>

      <PageHeader
        title={member.full_name ?? "İşçi"}
        description={member.email ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={member.role === "OWNER" ? "blue" : "neutral"}>
              {staffRoleLabels[member.role]}
            </Badge>
            {member.active ? (
              <Badge tone="green">Aktiv</Badge>
            ) : (
              <Badge tone="red">Deaktiv</Badge>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 font-semibold text-white">Rol və status</h2>

          <ActionForm action={updateStaff} className="space-y-4">
            <input type="hidden" name="staffId" value={member.id} />

            <Field label="Ad, soyad *" htmlFor="fullName">
              <input
                id="fullName"
                name="fullName"
                required
                maxLength={100}
                defaultValue={member.full_name ?? ""}
                className="input"
              />
            </Field>

            <Field
              label="Rol"
              htmlFor="role"
              hint={isSelf ? "Öz OWNER rolunuzu dəyişə bilməzsiniz." : undefined}
            >
              <select
                key={member.role}
                id="role"
                name="role"
                defaultValue={member.role}
                className="input"
              >
                {staffRoles.map((role) => (
                  <option key={role} value={role} disabled={isSelf && role !== "OWNER"}>
                    {staffRoleLabels[role]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Status" htmlFor="active">
              <select
                key={String(member.active)}
                id="active"
                name="active"
                defaultValue={member.active ? "true" : "false"}
                className="input"
              >
                <option value="true">Aktiv</option>
                <option value="false" disabled={isSelf}>
                  Deaktiv
                </option>
              </select>
            </Field>

            <SubmitButton pendingText="Yadda saxlanılır...">Yadda saxla</SubmitButton>
          </ActionForm>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="font-semibold text-white">Giriş və şifrə</h2>
          <p className="mt-1 mb-4 text-sm text-zinc-400">
            Mövcud şifrəni heç kim görə bilməz, yalnız sıfırlana bilər.
          </p>

          <dl className="mb-4 divide-y divide-zinc-800 text-sm">
            <div className="flex flex-wrap justify-between gap-2 py-2">
              <dt className="text-zinc-400">E-poçt</dt>
              <dd className="text-zinc-100">{member.email ?? "—"}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-2">
              <dt className="text-zinc-400">Şifrə</dt>
              <dd>
                {!member.must_change_password ? (
                  <span className="text-zinc-300">İşçi tərəfindən təyin edilib</span>
                ) : tempExpired ? (
                  <Badge tone="red">Müvəqqəti şifrənin vaxtı bitib</Badge>
                ) : (
                  <Badge tone="amber">
                    Müvəqqəti · {formatDate(member.temporary_password_expires_at!)} qədər
                  </Badge>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 py-2">
              <dt className="text-zinc-400">Son giriş</dt>
              <dd className="text-zinc-300">
                {member.last_sign_in_at ? formatDate(member.last_sign_in_at) : "—"}
              </dd>
            </div>
          </dl>

          {isSelf ? (
            <Link href="/change-password" className="btn btn-secondary">
              Öz şifrəmi dəyiş
            </Link>
          ) : (
            <div className="space-y-5">
              <PasswordResetForm
                action={resetStaffPassword}
                idName="staffId"
                idValue={member.id}
                confirmMessage="İşçinin şifrəsi sıfırlansın? Açıq sessiyaları dərhal bağlanacaq."
              />

              <ActionForm
                action={changeStaffEmail}
                resetOnSuccess
                className="flex flex-wrap items-end gap-3 border-t border-zinc-800 pt-4"
              >
                <input type="hidden" name="staffId" value={member.id} />

                <div className="min-w-56 flex-1">
                  <Field label="Yeni e-poçt" htmlFor="newEmail">
                    <input
                      id="newEmail"
                      type="email"
                      name="email"
                      required
                      maxLength={254}
                      autoComplete="off"
                      placeholder={member.email ?? ""}
                      className="input"
                    />
                  </Field>
                </div>

                <SubmitButton className="btn btn-secondary" pendingText="Yenilənir...">
                  E-poçtu dəyiş
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
