import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { Alert, Badge, Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_TEXT } from "@/lib/password";
import { can } from "@/lib/roles";
import {
  formatAzn,
  formatDate,
  orderStatusLabels,
  orderStatusTones,
  priceGroupLabels,
  shortId,
} from "@/lib/format";

import {
  archiveCustomer,
  permanentlyDeleteCustomer,
  restoreCustomer,
  setCustomerPassword,
  updateCustomerActive,
  updateCustomerEmail,
  updateCustomerProfile,
  resetCustomerMfa,
} from "../actions";

export const metadata: Metadata = {
  title: "Müştəri",
};

export default async function AdminCustomerDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/customers/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, role } = await requireStaff("customersView");
  const isOwner = can(role, "owner");
  const canEdit = can(role, "customersEdit");

  const [{ data: customers }, { data: orders }, { data: loginRows }] =
    await Promise.all([
      supabase.rpc("get_admin_customers"),
      supabase.rpc("get_admin_orders"),
      // Login and password details are OWNER-only (also in the database).
      isOwner
        ? supabase.rpc("get_admin_customer_login", { p_customer_id: id })
        : Promise.resolve({ data: null, error: null }),
    ]);

  const customer = customers?.find((item) => item.id === id);

  if (!customer) {
    notFound();
  }

  const customerOrders = (orders ?? []).filter(
    (order) => order.customer_id === id
  );
  const isArchived = customer.archived_at !== null;
  const login = loginRows?.[0];

  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-200"
      >
        ← Müştərilər
      </Link>

      {query.notice === "created" && (
        <Alert tone="green">Müştəri yaradıldı. İlk girişdə (24 saat ərzində) öz şifrəsini təyin edəcək.</Alert>
      )}

      <PageHeader
        title={customer.company_name ?? "Müştəri"}
        description={customer.email ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">{priceGroupLabels[customer.price_group]}</Badge>
            {isArchived ? (
              <Badge tone="amber">Arxivdə</Badge>
            ) : customer.active ? (
              <Badge tone="green">Aktiv</Badge>
            ) : (
              <Badge tone="red">Deaktiv</Badge>
            )}
          </div>
        }
      />

      {isArchived && (
        <Alert tone="amber">
          Bu müştəri arxivdədir: daxil ola bilmir və məlumatları
          dəyişdirilə bilməz. Davam etmək üçün arxivdən çıxarın.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 font-semibold text-white">Şirkət məlumatları</h2>

          <ActionForm action={updateCustomerProfile} className="space-y-4">
            <input type="hidden" name="customerId" value={customer.id} />

            <Field label="Şirkət adı *" htmlFor="companyName">
              <input
                id="companyName"
                name="companyName"
                required
                maxLength={200}
                disabled={isArchived || !canEdit}
                defaultValue={customer.company_name ?? ""}
                className="input"
              />
            </Field>

            <Field label="Əlaqə şəxsi *" htmlFor="contactName">
              <input
                id="contactName"
                name="contactName"
                required
                maxLength={200}
                disabled={isArchived || !canEdit}
                defaultValue={customer.contact_name ?? ""}
                className="input"
              />
            </Field>

            <Field label="Telefon" htmlFor="phone">
              <input
                id="phone"
                type="tel"
                name="phone"
                maxLength={40}
                disabled={isArchived || !canEdit}
                defaultValue={customer.phone ?? ""}
                className="input"
              />
            </Field>

            {!isArchived && canEdit && (
              <SubmitButton pendingText="Yadda saxlanılır...">
                Yadda saxla
              </SubmitButton>
            )}
          </ActionForm>
        </section>

        <div className="space-y-6">
          <section className="card p-5 sm:p-6">
            <h2 className="mb-4 font-semibold text-white">Status</h2>

            {isArchived ? (
              <p className="text-sm text-zinc-500">
                Arxivdəki müştəri üçün dəyişiklik edilə bilməz.
              </p>
            ) : !canEdit ? (
              <p className="text-sm text-zinc-400">
                Status: {customer.active ? "Aktiv" : "Deaktiv"}. Rolunuz yalnız
                baxmağa icazə verir.
              </p>
            ) : (
              <div className="space-y-4">
                <ActionForm
                  action={updateCustomerActive}
                  confirmMessage={
                    customer.active
                      ? "Müştəri deaktiv edilsin? O, daxil ola və sifariş verə bilməyəcək."
                      : undefined
                  }
                >
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={customer.active ? "false" : "true"}
                  />
                  <SubmitButton
                    className={`btn ${customer.active ? "btn-danger" : "btn-success"}`}
                  >
                    {customer.active ? "Deaktiv et" : "Aktiv et"}
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
          </section>

          {isOwner && (
          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold text-white">Giriş və şifrə</h2>
            <p className="mt-1 mb-4 text-sm text-zinc-400">
              Mövcud şifrəni heç kim görə bilməz. Müştəri şifrəsini
              unudubsa, ona yeni şifrə təyin edin.
            </p>

            <dl className="mb-4 divide-y divide-zinc-800 text-sm">
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-zinc-400">E-poçt</dt>
                <dd className="text-zinc-100">{login?.email ?? customer.email ?? "—"}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-zinc-400">Status</dt>
                <dd>
                  {isArchived ? (
                    <Badge tone="amber">Arxivdə</Badge>
                  ) : customer.active ? (
                    <Badge tone="green">Aktiv</Badge>
                  ) : (
                    <Badge tone="red">Deaktiv</Badge>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <dt className="text-zinc-400">Son giriş</dt>
                <dd className="text-zinc-300">
                  {login?.last_sign_in_at ? formatDate(login.last_sign_in_at) : "—"}
                </dd>
              </div>
            </dl>

            {!isArchived && (
              <div className="space-y-5">
                <ActionForm
                  action={setCustomerPassword}
                  resetOnSuccess
                  className="space-y-3"
                >
                  <input type="hidden" name="customerId" value={customer.id} />

                  <Field label="Yeni şifrə" htmlFor="newPassword" hint={PASSWORD_RULE_TEXT}>
                    <input
                      id="newPassword"
                      type="password"
                      name="password"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={72}
                      autoComplete="new-password"
                      className="input"
                    />
                  </Field>

                  <Field label="Yeni şifrəni təkrar yaz" htmlFor="newPasswordConfirm">
                    <input
                      id="newPasswordConfirm"
                      type="password"
                      name="passwordConfirm"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={72}
                      autoComplete="new-password"
                      className="input"
                    />
                  </Field>

                  <p className="text-xs text-zinc-500">
                    Müştərinin açıq sessiyaları bağlanacaq. Müştəri yeni şifrə
                    ilə dərhal daxil ola bilər.
                  </p>

                  <SubmitButton className="btn btn-primary" pendingText="Dəyişdirilir...">
                    Şifrəni dəyiş
                  </SubmitButton>
                </ActionForm>

                <ActionForm
                  action={updateCustomerEmail}
                  resetOnSuccess
                  className="flex flex-wrap items-end gap-3 border-t border-zinc-800 pt-4"
                >
                  <input type="hidden" name="customerId" value={customer.id} />

                  <div className="min-w-56 flex-1">
                    <Field label="Yeni e-poçt" htmlFor="newEmail">
                      <input
                        id="newEmail"
                        type="email"
                        name="email"
                        required
                        maxLength={254}
                        autoComplete="off"
                        placeholder={customer.email ?? ""}
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
          )}

          {!isArchived && isOwner && (
            <section className="card p-5 sm:p-6">
              <h2 className="font-semibold text-white">İki mərhələli təsdiq (2FA)</h2>
              <p className="mt-1 mb-4 text-sm text-zinc-400">
                Müştəri autentifikator cihazını itiribsə, kimliyini başqa
                kanalla (telefon zəngi, şəxsən) yoxladıqdan sonra sıfırlayın.
                Bundan sonra müştəri yalnız şifrə ilə daxil olur və istəsə yeni
                cihaz qoşa bilər. Əməliyyat audit jurnalına yazılır.
              </p>

              <ActionForm
                action={resetCustomerMfa}
                confirmMessage="Müştərinin bütün autentifikator cihazları silinsin? Müştəri yalnız şifrə ilə daxil olacaq."
              >
                <input type="hidden" name="customerId" value={customer.id} />
                <SubmitButton className="btn btn-danger" pendingText="Sıfırlanır...">
                  2FA-nı sıfırla
                </SubmitButton>
              </ActionForm>
            </section>
          )}
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-semibold text-white">
          Sifarişlər ({customerOrders.length})
        </h2>

        {customerOrders.length === 0 ? (
          <p className="card p-4 text-sm text-zinc-500">Sifariş yoxdur.</p>
        ) : (
          <div className="table-wrap">
            <table className="table min-w-0">
              <thead>
                <tr>
                  <th>Sifariş</th>
                  <th>Tarix</th>
                  <th>Status</th>
                  <th className="text-right">Məbləğ</th>
                </tr>
              </thead>
              <tbody>
                {customerOrders.map((order) => (
                  <tr key={order.order_id} className="hover:bg-zinc-900/60">
                    <td>
                      <Link
                        href={`/admin/orders/${order.order_id}`}
                        className="font-mono text-white hover:text-amber-400"
                      >
                        #{shortId(order.order_id)}
                      </Link>
                    </td>
                    <td className="text-zinc-400">{formatDate(order.created_at)}</td>
                    <td>
                      <Badge tone={orderStatusTones[order.status]}>
                        {orderStatusLabels[order.status]}
                      </Badge>
                    </td>
                    <td className="text-right font-semibold">
                      {formatAzn(order.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOwner && (
      <section className="card mt-6 border-red-900/50 p-5 sm:p-6">
        <h2 className="font-semibold text-white">Arxiv və silmə</h2>

        {isArchived ? (
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <ActionForm action={restoreCustomer}>
              <input type="hidden" name="customerId" value={customer.id} />
              <SubmitButton className="btn btn-success">Arxivdən çıxar</SubmitButton>
            </ActionForm>

            {customer.can_permanently_delete ? (
              <ActionForm
                action={permanentlyDeleteCustomer}
                confirmMessage={`${customer.company_name ?? "Bu müştəri"} həmişəlik silinsin?\n\nBu əməliyyat geri qaytarılmır.`}
              >
                <input type="hidden" name="customerId" value={customer.id} />
                <SubmitButton className="btn btn-danger" pendingText="Silinir...">
                  Həmişəlik sil
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-500">
                Sifarişi olan müştəri həmişəlik silinə bilməz.
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Arxivlənmiş müştəri daxil ola bilmir. Sifarişi olmayan
              arxiv müştəriləri həmişəlik silinə bilər.
            </p>

            <ActionForm
              action={archiveCustomer}
              className="mt-4"
              confirmMessage="Müştəri arxivləşdirilsin? O, daxil ola bilməyəcək."
            >
              <input type="hidden" name="customerId" value={customer.id} />
              <SubmitButton className="btn btn-danger">Arxivləşdir</SubmitButton>
            </ActionForm>
          </>
        )}
      </section>
      )}
    </>
  );
}
