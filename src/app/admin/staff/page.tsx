import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { formatDate, staffRoleLabels } from "@/lib/format";

export const metadata: Metadata = {
  title: "İşçilər",
};

export default async function AdminStaffPage() {
  const { supabase, user } = await requireOwner();

  const { data: staff, error } = await supabase.rpc("get_admin_staff");

  return (
    <>
      <PageHeader
        title="İşçilər"
        description="Hər işçinin öz e-poçtu, şifrəsi və rolu var. Şifrələri heç kim görə bilməz, yalnız sıfırlana bilər."
        actions={
          <Link href="/admin/staff/new" className="btn btn-primary">
            + Yeni işçi
          </Link>
        }
      />

      {error ? (
        <Alert>İşçilər yüklənərkən xəta baş verdi.</Alert>
      ) : !staff || staff.length === 0 ? (
        <EmptyState title="İşçi yoxdur" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>E-poçt</th>
                <th>Rol</th>
                <th>Status</th>
                <th>Son giriş</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id} className="hover:bg-zinc-900/60">
                  <td>
                    <Link
                      href={`/admin/staff/${member.id}`}
                      className="font-medium text-white hover:text-amber-400"
                    >
                      {member.full_name ?? "—"}
                    </Link>
                    {member.id === user.id && (
                      <span className="ml-2 text-xs text-zinc-500">(siz)</span>
                    )}
                  </td>
                  <td className="text-zinc-400">{member.email ?? "—"}</td>
                  <td>
                    <Badge tone={member.role === "OWNER" ? "blue" : "neutral"}>
                      {staffRoleLabels[member.role]}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {member.active ? (
                        <Badge tone="green">Aktiv</Badge>
                      ) : (
                        <Badge tone="red">Deaktiv</Badge>
                      )}
                      {member.must_change_password && (
                        <Badge tone="amber">Müvəqqəti şifrə</Badge>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-zinc-400">
                    {member.last_sign_in_at ? formatDate(member.last_sign_in_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
