"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type ActionResult,
  dbErrorMessage,
  fail,
  ok,
} from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const allowedPriceGroups = ["NORMAL", "DEALER", "VIP"] as const;

type PriceGroup = (typeof allowedPriceGroups)[number];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPriceGroup(value: unknown): value is PriceGroup {
  return allowedPriceGroups.includes(value as PriceGroup);
}

// Same rule as the Supabase Auth password policy: 12+ characters with
// lower- and upper-case letters, a digit and a symbol (bcrypt max 72 bytes).
function passwordProblem(password: string) {
  if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
    return "Şifrə 12–72 simvol olmalıdır.";
  }

  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "Şifrədə böyük və kiçik hərf, rəqəm və simvol olmalıdır.";
  }

  return null;
}

function readText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

async function getAuthedClient() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

// Service-role operations bypass RLS, so the database confirms the caller
// is an active OWNER with an MFA (aal2) session before the secret key is
// used. Any error or doubt means no access.
async function getOwnerClient() {
  const { supabase } = await getAuthedClient();

  const { data: isOwner, error } = await supabase.rpc("current_user_is_owner");

  if (error || isOwner !== true) {
    return null;
  }

  const { createAdminClient } = await import("@/lib/supabase/admin");

  return { supabase, admin: createAdminClient() };
}

type SecurityEvent =
  | "customer.login_created"
  | "customer.email_changed"
  | "customer.password_changed"
  | "customer.mfa_reset"
  | "customer.deleted";

async function recordEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: SecurityEvent,
  targetId: string
) {
  const { error } = await supabase.rpc("record_admin_security_event", {
    p_action: action,
    p_target_id: targetId,
  });

  if (error) {
    console.error("Audit event not recorded", action);
  }
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
    });

  if (profileError) {
    await owner.admin.auth.admin.deleteUser(createdUser.user.id);

    return fail("Müştəri profili yaradılmadı.");
  }

  await recordEvent(owner.supabase, "customer.login_created", createdUser.user.id);

  revalidateCustomerPaths();

  redirect(`/admin/customers/${createdUser.user.id}?notice=created`);
}

export async function updateCustomerLogin(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const customerId = readText(formData, "customerId");
  const email = readText(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!customerId) {
    return fail("Müştəri məlumatı yanlışdır.");
  }

  if (!email && !password) {
    return fail("Yeni e-poçt və ya yeni şifrə daxil edin.");
  }

  if (email && !emailPattern.test(email)) {
    return fail("Düzgün e-poçt ünvanı daxil edin.");
  }

  const weakPassword = password ? passwordProblem(password) : null;

  if (weakPassword) {
    return fail(weakPassword);
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  // Only customer accounts may be changed here, never staff accounts. The
  // RPC raises "Customer not found" for any id without a customer profile.
  const { data: customerStatus, error: customerError } =
    await owner.supabase.rpc("get_admin_customer_delete_status", {
      p_customer_id: customerId,
    });

  const profile = customerStatus?.[0];

  if (customerError || !profile) {
    return fail("Müştəri tapılmadı.");
  }

  if (profile.archived) {
    return fail("Arxivdəki müştərinin giriş məlumatları dəyişdirilə bilməz.");
  }

  const attributes: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
  } = {};

  if (email) {
    attributes.email = email;
    attributes.email_confirm = true;
  }

  if (password) {
    attributes.password = password;
  }

  const { error } = await owner.admin.auth.admin.updateUserById(
    customerId,
    attributes
  );

  if (error) {
    return fail(
      error.code === "email_exists"
        ? "Bu e-poçt başqa istifadəçi tərəfindən istifadə olunur."
        : "Giriş məlumatları yenilənmədi."
    );
  }

  if (email) await recordEvent(owner.supabase, "customer.email_changed", customerId);
  if (password) await recordEvent(owner.supabase, "customer.password_changed", customerId);

  revalidateCustomerPaths(customerId);

  return ok("Giriş məlumatları yeniləndi.");
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

  await recordEvent(owner.supabase, "customer.deleted", customerId);

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

  await recordEvent(owner.supabase, "customer.mfa_reset", customerId);

  revalidateCustomerPaths(customerId);

  return ok("2FA sıfırlandı. Müştəri növbəti girişdə yeni cihaz qoşacaq.");
}
