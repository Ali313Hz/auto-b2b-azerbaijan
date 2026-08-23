"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const allowedPriceGroups = ["NORMAL", "DEALER", "VIP"] as const;

export async function updateCustomerPriceGroup(formData: FormData) {
  const customerId = formData.get("customerId");
  const priceGroup = formData.get("priceGroup");

  if (
    typeof customerId !== "string" ||
    typeof priceGroup !== "string" ||
    !allowedPriceGroups.includes(
      priceGroup as (typeof allowedPriceGroups)[number]
    )
  ) {
    throw new Error("Geçersiz müşteri veya fiyat grubu.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("set_customer_price_group", {
    target_customer_id: customerId,
    new_price_group: priceGroup as "NORMAL" | "DEALER" | "VIP",
  });

  if (error) {
    throw new Error("Fiyat grubu güncellenemedi.");
  }

  revalidatePath("/admin/customers");
  revalidatePath("/account");
  revalidatePath("/products");
}
export async function updateCustomerActive(formData: FormData) {
  const customerId = formData.get("customerId");
  const activeValue = formData.get("active");

  if (
    typeof customerId !== "string" ||
    typeof activeValue !== "string" ||
    (activeValue !== "true" && activeValue !== "false")
  ) {
    throw new Error("Geçersiz müşteri bilgisi.");
  }

  const active = activeValue === "true";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc("set_customer_active", {
    target_customer_id: customerId,
    new_active: active,
  });

  if (error) {
    throw new Error("Müşteri durumu güncellenemedi.");
  }

  revalidatePath("/admin/customers");
  revalidatePath("/account");
  revalidatePath("/products");
  revalidatePath("/cart");
  revalidatePath("/orders");
}

export async function createCustomer(formData: FormData) {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const companyNameValue = formData.get("companyName");
  const contactNameValue = formData.get("contactName");
  const phoneValue = formData.get("phone");
  const priceGroupValue = formData.get("priceGroup");
  const activeValue = formData.get("active");

  if (
    typeof emailValue !== "string" ||
    typeof passwordValue !== "string" ||
    typeof companyNameValue !== "string" ||
    typeof contactNameValue !== "string" ||
    typeof phoneValue !== "string" ||
    typeof priceGroupValue !== "string" ||
    typeof activeValue !== "string" ||
    !allowedPriceGroups.includes(
      priceGroupValue as (typeof allowedPriceGroups)[number]
    ) ||
    (activeValue !== "true" && activeValue !== "false")
  ) {
    throw new Error("Geçersiz müşteri bilgisi.");
  }

  const email = emailValue.trim().toLowerCase();
  const password = passwordValue;
  const companyName = companyNameValue.trim();
  const contactName = contactNameValue.trim();
  const phone = phoneValue.trim();
  const active = activeValue === "true";

  if (
    !email ||
    password.length < 8 ||
    !companyName ||
    !contactName
  ) {
    throw new Error("Müşteri bilgileri eksik veya geçersiz.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!staff || !staff.active || staff.role !== "OWNER") {
    throw new Error("Bu işlem için yetkiniz yok.");
  }

  const { createAdminClient } = await import(
    "@/lib/supabase/admin"
  );

  const admin = createAdminClient();

  const {
    data: createdUser,
    error: authError,
  } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !createdUser.user) {
   

    throw new Error("Müşteri giriş hesabı oluşturulamadı.");
  }

  const { error: profileError } = await admin
    .from("customer_profiles")
    .insert({
      id: createdUser.user.id,
      company_name: companyName,
      contact_name: contactName,
      phone: phone || null,
      price_group: priceGroupValue as "NORMAL" | "DEALER" | "VIP",
      active,
    });

  if (profileError) {
   

    await admin.auth.admin.deleteUser(createdUser.user.id);

    throw new Error("Müşteri profili oluşturulamadı.");
  }

  revalidatePath("/admin/customers");
}
export async function updateCustomerProfile(formData: FormData) {
  const customerId = formData.get("customerId");
  const companyName = formData.get("companyName");
  const contactName = formData.get("contactName");
  const phone = formData.get("phone");

  if (
    typeof customerId !== "string" ||
    typeof companyName !== "string" ||
    typeof contactName !== "string" ||
    typeof phone !== "string" ||
    !companyName.trim() ||
    !contactName.trim()
  ) {
    throw new Error("Geçersiz müşteri bilgisi.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Oturum bulunamadı.");
  }

  const { error } = await supabase.rpc(
    "update_admin_customer_profile",
    {
      p_customer_id: customerId,
      p_company_name: companyName,
      p_contact_name: contactName,
      p_phone: phone,
    }
  );

  if (error) {
    throw new Error("Müşteri bilgileri güncellenemedi.");
  }

  revalidatePath("/admin/customers");
  revalidatePath("/account");
}