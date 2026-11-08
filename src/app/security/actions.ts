"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, fail, ok } from "@/lib/action-result";
import { requireMfaUser } from "@/lib/auth";
import { MFA_REQUIRED } from "@/lib/mfa";

// Removes one of the user's own authenticators. The last verified one can
// only be removed while MFA is optional.
export async function removeFactor(
  _state: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const factorId = formData.get("factorId");

  if (typeof factorId !== "string" || !factorId) {
    return fail("Cihaz məlumatı yanlışdır.");
  }

  const { supabase } = await requireMfaUser();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp ?? [];

  if (!verified.some((factor) => factor.id === factorId)) {
    return fail("Cihaz tapılmadı.");
  }

  if (MFA_REQUIRED && verified.length < 2) {
    return fail("Son autentifikatoru silmək olmaz. Əvvəlcə ehtiyat cihaz əlavə edin.");
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    return fail("Cihaz silinmədi.");
  }

  revalidatePath("/security");

  return ok("Cihaz silindi.");
}
