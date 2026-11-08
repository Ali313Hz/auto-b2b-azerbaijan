import type { Metadata } from "next";

import Pagination from "@/components/Pagination";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { formatDate, readPage } from "@/lib/format";

export const metadata: Metadata = {
  title: "Audit jurnalı",
};

const PAGE_SIZE = 50;

const actionLabels: Record<string, string> = {
  "customer.login_created": "Giriş hesabı yaradıldı",
  "customer.email_changed": "E-poçt dəyişdirildi",
  "customer.password_changed": "Şifrə dəyişdirildi",
  "customer.mfa_reset": "2FA sıfırlandı",
  "customer.deleted": "Müştəri silindi",
  customer_created: "Müştəri hesabı yaradıldı",
  customer_password_reset: "Müştəri şifrəsi sıfırlandı",
  customer_email_changed: "Müştəri e-poçtu dəyişdirildi",
  customer_activated: "Müştəri aktiv edildi",
  customer_deactivated: "Müştəri deaktiv edildi",
  customer_archived: "Müştəri arxivləşdirildi",
  customer_restored: "Müştəri arxivdən çıxarıldı",
  customer_mfa_reset: "Müştəri 2FA sıfırlandı",
  customer_deleted: "Müştəri silindi",
  staff_created: "İşçi hesabı yaradıldı",
  staff_password_reset: "İşçi şifrəsi sıfırlandı",
  staff_email_changed: "İşçi e-poçtu dəyişdirildi",
  staff_role_changed: "İşçi rolu dəyişdirildi",
  staff_activated: "İşçi aktiv edildi",
  staff_deactivated: "İşçi deaktiv edildi",
};

const tableLabels: Record<string, string> = {
  customer_profiles: "Müştəri",
  staff_profiles: "İşçi",
  products: "Məhsul",
  product_prices: "Qiymət",
  categories: "Kateqoriya",
  product_media: "Media",
  orders: "Sifariş",
};

const opLabels: Record<string, string> = {
  insert: "yaradıldı",
  update: "dəyişdirildi",
  delete: "silindi",
};

function describe(action: string) {
  if (actionLabels[action]) {
    return actionLabels[action];
  }

  const [table, op] = action.split(".");

  return `${tableLabels[table] ?? table} ${opLabels[op] ?? op}`;
}

export default async function AuditPage({
  searchParams,
}: PageProps<"/admin/audit">) {
  const params = await searchParams;
  const page = readPage(params.page);
  const { supabase } = await requireOwner();

  const { data, error } = await supabase.rpc("get_admin_audit_log", {
    p_page: page,
    p_page_size: PAGE_SIZE,
  });

  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;

  return (
    <>
      <PageHeader
        title="Audit jurnalı"
        description="Admin əməliyyatlarının dəyişdirilə və silinə bilməyən qeydi. Yalnız dəyişən sahələrin adları saxlanılır."
      />

      {error && <Alert>Jurnal yüklənmədi.</Alert>}

      {!error && rows.length === 0 ? (
        <EmptyState title="Hələ qeyd yoxdur" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tarix</th>
                <th>İcraçı</th>
                <th>Əməliyyat</th>
                <th>Obyekt</th>
                <th>Dəyişən sahələr</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const details = row.details as
                  | { changed?: string[]; from?: string; to?: string }
                  | null;
                const changed =
                  details?.changed?.join(", ") ??
                  (details?.from && details.to ? `${details.from} → ${details.to}` : null);

                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-zinc-400">{formatDate(row.created_at)}</td>
                    <td>{row.actor_name ?? (row.actor_user_id ? "—" : "Sistem / server")}</td>
                    <td className="whitespace-nowrap">{describe(row.action)}</td>
                    <td className="font-mono text-xs text-zinc-500">{row.target_id?.slice(0, 8) ?? "—"}</td>
                    <td className="text-xs text-zinc-400">{changed ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/audit" params={{}} />
    </>
  );
}
