import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { priceGroupLabels } from "@/lib/format";

export const metadata: Metadata = {
  title: "Müştərilər",
};

const statusFilters = [
  { value: "", label: "Hamısı" },
  { value: "active", label: "Aktiv" },
  { value: "inactive", label: "Deaktiv" },
  { value: "archived", label: "Arxiv" },
];

export default async function AdminCustomersPage({
  searchParams,
}: PageProps<"/admin/customers">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const normalizedQuery = query.toLocaleLowerCase("az");
  const statusFilter =
    typeof params.status === "string" ? params.status : "";

  const { supabase } = await requireOwner();

  const { data: customers, error } = await supabase.rpc(
    "get_admin_customers"
  );

  if (error) {
    return (
      <>
        <PageHeader title="Müştərilər" />
        <Alert>Müştərilər yüklənərkən xəta baş verdi.</Alert>
      </>
    );
  }

  const allCustomers = customers ?? [];

  const visibleCustomers = allCustomers.filter((customer) => {
    const archived = customer.archived_at !== null;

    if (statusFilter === "active" && (!customer.active || archived)) return false;
    if (statusFilter === "inactive" && (customer.active || archived)) return false;
    if (statusFilter === "archived" && !archived) return false;

    if (!normalizedQuery) {
      return true;
    }

    return [customer.company_name, customer.contact_name, customer.email, customer.phone]
      .filter(Boolean)
      .some((value) =>
        String(value).toLocaleLowerCase("az").includes(normalizedQuery)
      );
  });

  return (
    <>
      {params.notice === "deleted" && (
        <Alert tone="green">Müştəri həmişəlik silindi.</Alert>
      )}

      <PageHeader
        title="Müştərilər"
        description={`${allCustomers.length} müştəri`}
        actions={
          <Link href="/admin/customers/new" className="btn btn-primary">
            + Yeni müştəri
          </Link>
        }
      />

      <form
        action="/admin/customers"
        className="card mb-6 flex flex-wrap items-end gap-3 p-4"
      >
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="customer-search" className="label">
            Axtar
          </label>
          <input
            id="customer-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Şirkət, ad, e-poçt və ya telefon"
            className="input"
          />
        </div>

        <div className="w-40">
          <label htmlFor="customer-status" className="label">
            Status
          </label>
          <select
            id="customer-status"
            name="status"
            defaultValue={statusFilter}
            className="input"
          >
            {statusFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn btn-secondary">
          Filtrlə
        </button>
      </form>

      {visibleCustomers.length === 0 ? (
        <EmptyState
          title={
            allCustomers.length === 0
              ? "Hələ müştəri yoxdur"
              : "Uyğun müştəri tapılmadı"
          }
          action={
            allCustomers.length === 0 ? (
              <Link href="/admin/customers/new" className="btn btn-primary">
                İlk müştərini yarat
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Şirkət</th>
                <th>Əlaqə</th>
                <th>Qrup</th>
                <th>Status</th>
                <th className="text-right">Sifariş</th>
                <th className="sr-only">Əməliyyat</th>
              </tr>
            </thead>

            <tbody>
              {visibleCustomers.map((customer) => (
                <tr key={customer.id} className="hover:bg-zinc-900/60">
                  <td className="max-w-xs">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="block truncate font-medium text-white hover:text-amber-400"
                    >
                      {customer.company_name ?? "—"}
                    </Link>
                    <span className="block truncate text-xs text-zinc-500">
                      {customer.email ?? "—"}
                    </span>
                  </td>
                  <td className="text-zinc-300">
                    {customer.contact_name ?? "—"}
                    {customer.phone && (
                      <span className="block text-xs text-zinc-500">
                        {customer.phone}
                      </span>
                    )}
                  </td>
                  <td>
                    <Badge tone="blue">
                      {priceGroupLabels[customer.price_group]}
                    </Badge>
                  </td>
                  <td>
                    {customer.archived_at ? (
                      <Badge tone="amber">Arxivdə</Badge>
                    ) : customer.active ? (
                      <Badge tone="green">Aktiv</Badge>
                    ) : (
                      <Badge tone="red">Deaktiv</Badge>
                    )}
                  </td>
                  <td className="text-right">{customer.order_count}</td>
                  <td className="text-right">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      İdarə et
                    </Link>
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
