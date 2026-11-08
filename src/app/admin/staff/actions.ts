"use server";

import { revalidatePath } from "next/cache";

import type { PasswordResetResult } from "@/components/PasswordResetForm";
import {
  type ActionResult,
  fail,
  ok,
} from "@/lib/action-result";
import { staffRoles } from "@/lib/format";
import {
  getOwnerClient,
  recordEvent,
  resetAccountPassword,
  temporaryPasswordFrom,
} from "@/lib/owner";

type StaffRole = (typeof staffRoles)[number];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function isStaffRole(value: string): value is StaffRole {
  return (staffRoles as readonly string[]).includes(value);
}

const staffErrors: Record<string, string> = {
  "You cannot remove your own OWNER access":
    "Öz OWNER rolunuzu dəyişə və ya özünüzü deaktiv edə bilməzsiniz.",
  "At least one active OWNER is required":
    "Ən azı bir aktiv OWNER qalmalıdır.",
  "Staff member not found": "İşçi tapılmadı.",
  "Staff name is required": "Ad tələb olunur (maks. 100 simvol).",
};

function revalidateStaff(staffId?: string) {
  revalidatePath("/admin/staff");

  if (staffId) {
    revalidatePath(`/admin/staff/${staffId}`);
  }
}

// Checks in the database that the id belongs to a staff account.
async function findStaff(
  owner: NonNullable<Awaited<ReturnType<typeof getOwnerClient>>>,
  staffId: string
) {
  const { data, error } = await owner.supabase.rpc("get_admin_staff");

  if (error) {
    return null;
  }

  return data?.find((member) => member.id === staffId) ?? null;
}

// Creates the Auth user with a temporary password (shown once to the
// OWNER) and the staff profile. The new member must change the password at
// first login.
export async function createStaff(
  _state: PasswordResetResult,
  formData: FormData
): Promise<PasswordResetResult> {
  const email = readText(formData, "email").toLowerCase();
  const fullName = readText(formData, "fullName");
  const role = readText(formData, "role");

  if (!emailPattern.test(email)) {
    return { ok: false, message: "Düzgün e-poçt ünvanı daxil edin." };
  }

  if (!fullName || fullName.length > 100) {
    return { ok: false, message: "Ad tələb olunur (maks. 100 simvol)." };
  }

  if (!isStaffRole(role)) {
    return { ok: false, message: "Rol seçin." };
  }

  const { password, problem } = temporaryPasswordFrom(formData);

  if (problem) {
    return { ok: false, message: problem };
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return { ok: false, message: "Bu əməliyyat üçün icazəniz yoxdur." };
  }

  const { data: created, error: authError } =
    await owner.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError || !created.user) {
    return {
      ok: false,
      message:
        authError?.code === "email_exists"
          ? "Bu e-poçt ilə istifadəçi artıq mövcuddur."
          : authError?.code === "weak_password"
            ? "Şifrə Supabase şifrə qaydasına uyğun deyil."
            : "Giriş hesabı yaradılmadı.",
    };
  }

  // Runs as the OWNER: the database checks the role again and audits it.
  const { error: profileError } = await owner.supabase.rpc(
    "create_admin_staff_profile",
    { p_user_id: created.user.id, p_full_name: fullName, p_role: role }
  );

  if (profileError) {
    await owner.admin.auth.admin.deleteUser(created.user.id);

    return { ok: false, message: "İşçi profili yaradılmadı." };
  }

  revalidateStaff();

  return {
    ok: true,
    message: "İşçi yaradıldı.",
    temporaryPassword: password,
  };
}

export async function updateStaff(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const staffId = readText(formData, "staffId");
  const fullName = readText(formData, "fullName");
  const role = readText(formData, "role");
  const active = readText(formData, "active");

  if (!staffId || !isStaffRole(role) || (active !== "true" && active !== "false")) {
    return fail("İşçi məlumatı yanlışdır.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  const { error } = await owner.supabase.rpc("update_admin_staff", {
    p_staff_id: staffId,
    p_full_name: fullName,
    p_role: role,
    p_active: active === "true",
  });

  if (error) {
    return fail(staffErrors[error.message] ?? "İşçi yenilənmədi.");
  }

  revalidateStaff(staffId);

  return ok("Yadda saxlandı.");
}

export async function changeStaffEmail(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const staffId = readText(formData, "staffId");
  const email = readText(formData, "email").toLowerCase();

  if (!staffId) {
    return fail("İşçi məlumatı yanlışdır.");
  }

  if (!emailPattern.test(email)) {
    return fail("Düzgün e-poçt ünvanı daxil edin.");
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return fail("Bu əməliyyat üçün icazəniz yoxdur.");
  }

  if (staffId === owner.user.id) {
    return fail("Öz e-poçtunuzu burada dəyişə bilməzsiniz.");
  }

  if (!(await findStaff(owner, staffId))) {
    return fail("İşçi tapılmadı.");
  }

  const { error } = await owner.admin.auth.admin.updateUserById(staffId, {
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

  await recordEvent(owner.supabase, "staff_email_changed", staffId);

  revalidateStaff(staffId);

  return ok("E-poçt yeniləndi.");
}

export async function resetStaffPassword(
  _state: PasswordResetResult,
  formData: FormData
): Promise<PasswordResetResult> {
  const staffId = readText(formData, "staffId");

  if (!staffId) {
    return { ok: false, message: "İşçi məlumatı yanlışdır." };
  }

  const owner = await getOwnerClient();

  if (!owner) {
    return { ok: false, message: "Bu əməliyyat üçün icazəniz yoxdur." };
  }

  const result = await resetAccountPassword(owner, staffId, "staff", formData);

  revalidateStaff(staffId);

  return result;
}
