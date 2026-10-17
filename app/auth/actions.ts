"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOwnerEmail, getSupabaseConfig } from "../../lib/supabase/config";
import { createClient } from "../../lib/supabase/server";

export async function signIn(formData: FormData): Promise<void> {
  const ownerEmail = getOwnerEmail();
  if (!getSupabaseConfig() || !ownerEmail) redirect("/setup");

  const emailValue = formData.get("email");
  const password = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  if (email !== ownerEmail || typeof password !== "string" || !password || password.length > 4096) {
    redirect("/login?error=credentials");
  }

  const supabase = await createClient();
  let result;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    redirect("/login?error=unavailable");
  }
  if (result.error || !result.data.user) redirect("/login?error=credentials");
  if (result.data.user.email?.trim().toLowerCase() !== ownerEmail) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login?error=credentials");
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (!getSupabaseConfig()) redirect("/setup");
  const supabase = await createClient();
  let failed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  if (failed) redirect("/login?error=signout");
  revalidatePath("/", "layout");
  redirect("/login");
}
