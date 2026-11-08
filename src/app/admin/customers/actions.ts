"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import {
  getAuthedClient,
  getOwnerClient,
  recordEvent,
} from "@/lib/owner";
import { passwordProblem } from "@/lib/password";

const allowedPriceGroups = ["NORMAL", "DEALER", "VIP"] as const;

type PriceGroup = (typeof allowedPriceGroups)[number];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPriceGroup(value: unknown): value is PriceGroup {
  return allowedPriceGroups.includes(value as PriceGroup);
}

function readText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function revalidateCustomerPaths(customerId?: string) {
  revalidatePath("/admin/customers");
  revalidatePath("/admin");

  if (customerId) {
    revalidatePath(`/admin/customers/${customerId}`);
  }
}

export async function updateCustomerPriceGroup(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const priceGroup = readText(formData, "priceGroup");

  if (!customerId || !isPriceGroup(priceGroup)) {
    return fail("Müştəri və ya qiymət qrupu yanlışdır.");
  }

  const { supabase } = await getAuthedClient();

  const { error } = await supabase.rpc("set_customer_price_group", {
    target_customer_id: customerId,
    new_price_group: priceGroup,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Qiymət qrupu dəyişdirilmədi."));
  }

  revalidateCustomerPaths(customerId);

  return ok("Qiymət qrupu yadda saxlandı.");
}

export async function updateCustomerActive(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const activeValue = readText(formData, "active");

  if (!customerId || (activeValue !== "true" && activeValue !== "false")) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  const { supabase } = await getAuthedClient();

  const { error } = await supabase.rpc("set_customer_active", {
    target_customer_id: customerId,
    new_active: activeValue === "true",
  });

  if (error) {
    return fail(dbErrorMessage(error, "Müştərinin statusu dəyişdirilmədi."));
  }

  await recordEvent(
    supabase,
    activeValue === "true" ? "customer_activated" : "customer_deactivated",
    customerId
  );

  revalidateCustomerPaths(customerId);

  return ok(
    activeValue === "true" ? "Müştəri aktiv edildi." : "Müştəri deaktiv edildi."
  );
}

export async function createCustomer(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const email = readText(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const companyName = readText(formData, "companyName");
  const contactName = readText(formData, "contactName");
  const phone = readText(formData, "phone");
  const priceGroup = readText(formData, "priceGroup");
  const activeValue = readText(formData, "active");

  if (!emailPattern.test(email)) {
    return fail("Düzgün e-poçt ünvanı daxil edin.");
  }

  const weakPassword = passwordProblem(password);

  if (weakPassword) {
    return fail(weakPassword);
  }

  if (!companyName || !contactName) {
    return fail("Şirkət adı və əlaqə şəxsi mütləqdir.");
  }

  if (!isPriceGroup(priceGroup) || (activeValue !== "true" && activeValue !== "false")) {
    return fail("Qiymət qrupu və ya status yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { data: createdUser, error: authError } =
    await owner.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError || !createdUser.user) {
    return fail(
      authError?.code === "email_exists"
        ? "Bu e-poçt ilə istifadəçi artıq mövcuddur."
        : "Giriş hesabı yaradılmadı."
    );
  }

  const { error: profileError } = await owner.admin
    .from("customer_profiles")
    .insert({
      id: createdUser.user.id,
      company_name: companyName,
      contact_name: contactName,
      phone: phone || null,
      price_group: priceGroup,
      active: activeValue === "true",
      // The OWNER chose this password, so the customer replaces it at the
      // first login (within 24 hours, like a reset).
      must_change_password: true,
      temporary_password_expires_at: new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString(),
      credentials_changed_at: new Date().toISOString(),
    });

  if (profileError) {
    await owner.admin.auth.admin.deleteUser(createdUser.user.id);

    return fail("Müştəri profili yaradılmadı.");
  }

  await recordEvent(owner.supabase, "customer_created", createdUser.user.id);

  revalidateCustomerPaths();

  redirect(`/admin/customers/${createdUser.user.id}?notice=created`);
}

// E-mail change only. Passwords are changed with setCustomerPassword.
export async function updateCustomerEmail(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const email = readText(formData, "email").toLowerCase();

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  if (!emailPattern.test(email)) {
    return fail("Düzgün e-poçt ünvanı daxil edin.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  // Only customer accounts may be changed here, never staff accounts. The
  // RPC raises "Customer not found" for any id without a customer profile.
  const { data: login, error: loginError } = await owner.supabase.rpc(
    "get_admin_customer_login",
    { p_customer_id: customerId }
  );

  const profile = login?.[0];

  if (loginError || !profile) {
    return fail("Müştəri tapılmadı.");
  }

  if (profile.archived_at) {
    return fail("Arxivdəki müştərinin giriş məlumatları dəyişdirilə bilməz.");
  }

  const { error } = await owner.admin.auth.admin.updateUserById(customerId, {
    email,
    email_confirm: true,
  });

  if (error) {
    return fail(
      error.code === "email_exists"
        ? "Bu e-poçt başqa istifadəçi tərəfindən istifadə olunur."
        : "E-poçt yenilənmədi."
    );
  }

  await recordEvent(owner.supabase, "customer_email_changed", customerId);

  revalidateCustomerPaths(customerId);

  return ok("E-poçt yeniləndi.");
}

// OWNER sets a temporary password (generated or typed). Staff accounts and
// the OWNER's own account are refused by the database.
// OWNER sets a new permanent password for a customer who forgot theirs.
// The current password is never shown or stored; the new one goes only to
// Supabase Auth (bcrypt) through the server-side Admin API and is never
// returned, logged or written to the database.
export async function setCustomerPassword(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const password = formData.get("password");
  const confirm = formData.get("passwordConfirm");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  if (typeof password !== "string" || typeof confirm !== "string") {
    return fail("Yeni şifrəni daxil edin.");
  }

  if (password !== confirm) {
    return fail("Şifrələr eyni deyil.");
  }

  const problem = passwordProblem(password);

  if (problem) {
    return fail(problem);
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  if (customerId === owner.user.id) {
    return fail("Öz şifrənizi “Şifrəni dəyiş” səhifəsində dəyişin.");
  }

  // The database confirms the OWNER and that the target is a customer
  // (not staff, not archived), ends the old sessions' access and writes the
  // audit row before the secret key is used.
  const { error: stateError } = await owner.supabase.rpc(
    "set_admin_customer_password_state",
    { p_customer_id: customerId }
  );

  if (stateError) {
    return fail(
      stateError.message === "Archived customer cannot be changed"
        ? "Arxivdəki müştərinin şifrəsi dəyişdirilə bilməz."
        : stateError.message === "Customer not found"
          ? "Müştəri tapılmadı."
          : "Şifrə dəyişdirilmədi."
    );
  }

  // Supabase also signs the user out everywhere when the password changes.
  const { error: authError } = await owner.admin.auth.admin.updateUserById(
    customerId,
    { password }
  );

  revalidateCustomerPaths(customerId);

  if (authError) {
    return fail(
      authError.code === "weak_password"
        ? "Şifrə Supabase şifrə qaydasına uyğun deyil. Başqa şifrə seçin."
        : "Şifrə dəyişdirilmədi. Yenidən cəhd edin."
    );
  }

  return ok("Şifrə uğurla dəyişdirildi.");
}

export async function updateCustomerProfile(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const companyName = readText(formData, "companyName");
  const contactName = readText(formData, "contactName");
  const phone = readText(formData, "phone");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  if (!companyName || !contactName) {
    return fail("Şirkət adı və əlaqə şəxsi mütləqdir.");
  }

  const { supabase } = await getAuthedClient();

  const { error } = await supabase.rpc("update_admin_customer_profile", {
    p_customer_id: customerId,
    p_company_name: companyName,
    p_contact_name: contactName,
    p_phone: phone,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Müştəri məlumatları yenilənmədi."));
  }

  revalidateCustomerPaths(customerId);

  return ok("Müştəri məlumatları yadda saxlandı.");
}

export async function archiveCustomer(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  // The RPC raises "Customer not found" for anything but a customer.
  const { error } = await owner.supabase.rpc("archive_admin_customer", {
    p_customer_id: customerId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Müştəri arxivləşdirilmədi."));
  }

  // Archived customers cannot sign in at all (not only lose data access).
  const { error: banError } = await owner.admin.auth.admin.updateUserById(
    customerId,
    { ban_duration: "876000h" }
  );

  await recordEvent(owner.supabase, "customer_archived", customerId);

  revalidateCustomerPaths(customerId);

  if (banError) {
    return fail("Müştəri arxivləşdirildi, lakin giriş bloklanmadı. Yenidən cəhd edin.");
  }

  return ok("Müştəri arxivləşdirildi.");
}

export async function restoreCustomer(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { error } = await owner.supabase.rpc("restore_admin_customer", {
    p_customer_id: customerId,
  });

  if (error) {
    return fail(dbErrorMessage(error, "Müştəri arxivdən çıxarılmadı."));
  }

  // Restored customers stay inactive until the OWNER activates them.
  await owner.admin.auth.admin.updateUserById(customerId, {
    ban_duration: "none",
  });

  await recordEvent(owner.supabase, "customer_restored", customerId);

  revalidateCustomerPaths(customerId);

  return ok("Müştəri arxivdən çıxarıldı. Giriş üçün onu aktiv edin.");
}

export async function permanentlyDeleteCustomer(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { data: deleteStatus, error: statusError } = await owner.supabase.rpc(
    "get_admin_customer_delete_status",
    { p_customer_id: customerId }
  );

  const status = deleteStatus?.[0];

  if (statusError || !status) {
    return fail("Silmə imkanı yoxlanılmadı.");
  }

  if (!status.archived || status.order_count !== 0 || !status.can_delete) {
    return fail(
      "Müştəri həmişəlik silinə bilməz: əvvəlcə arxivləşdirilməli və heç bir sifarişi olmamalıdır."
    );
  }

  const { error: deleteError } =
    await owner.admin.auth.admin.deleteUser(customerId);

  if (deleteError) {
    return fail("Müştəri silinmədi.");
  }

  await recordEvent(owner.supabase, "customer_deleted", customerId);

  revalidateCustomerPaths();

  redirect("/admin/customers?notice=deleted");
}

// Lost-authenticator recovery for customers. Only an aal2 OWNER can do it,
// only for customer accounts, and every reset is written to the audit log.
// The customer still needs their password and must enroll a new device.
export async function resetCustomerMfa(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { data: customerStatus, error: customerError } =
    await owner.supabase.rpc("get_admin_customer_delete_status", {
      p_customer_id: customerId,
    });

  const profile = customerStatus?.[0];

  if (customerError || !profile) {
    return fail("Müştəri tapılmadı.");
  }

  if (profile.archived) {
    return fail("Arxivdəki müştərinin 2FA-sı sıfırlana bilməz.");
  }

  const { data: factors, error: listError } =
    await owner.admin.auth.admin.mfa.listFactors({ userId: customerId });

  if (listError) {
    return fail("2FA sıfırlanmadı.");
  }

  for (const factor of factors?.factors ?? []) {
    const { error } = await owner.admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: customerId,
    });

    if (error) {
      return fail("2FA tam sıfırlanmadı. Yenidən cəhd edin.");
    }
  }

  await recordEvent(owner.supabase, "customer_mfa_reset", customerId);

  revalidateCustomerPaths(customerId);

  return ok("2FA sıfırlandı. Müştəri şifrə ilə daxil ola bilər.");
}
