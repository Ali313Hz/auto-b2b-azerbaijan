"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createClient();

  // Only this browser; the user's other devices stay signed in.
  await supabase.auth.signOut({ scope: "local" });

  redirect("/login");
}