"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accessKeyEmail, normalizeAccessKey } from "../../lib/access-key";
import { getPortalUser, PortalAccessError } from "../../lib/auth";
import { getSupabaseConfig } from "../../lib/supabase/config";
import { createClient } from "../../lib/supabase/server";

export async function signIn(formData: FormData): Promise<void> {
  if (!getSupabaseConfig()) redirect("/login?error=setup");
  const loginValue = formData.get("email");
  const password = formData.get("password");
  const login = typeof loginValue === "string" ? loginValue.trim().toLowerCase() : "";
  let email: string;
  if (login.includes("@")) {
    // Internal customer addresses are implementation details, not login names.
    if (login.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) || login.endsWith("@customers.grandsave.invalid")) redirect("/login?error=credentials");
    email = login;
  } else {
    const key = normalizeAccessKey(login);
    if (!key) redirect("/login?error=credentials");
    email = accessKeyEmail(key);
  }
  if (typeof password !== "string" || !password || password.length > 4096) redirect("/login?error=credentials");

  const supabase = await createClient();
  let result;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    redirect("/login?error=unavailable");
  }
  if (result.error || !result.data.user) {
    redirect(`/login?error=${result.error?.status === 429 ? "rate-limit" : "credentials"}`);
  }

  let portalUser;
  try {
    portalUser = await getPortalUser();
  } catch (error) {
    if (error instanceof PortalAccessError) redirect(`/login?error=${error.kind === "setup" ? "portal-setup" : "unavailable"}`);
    throw error;
  }
  if (!portalUser) redirect("/login?error=access");
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (!getSupabaseConfig()) redirect("/login?error=setup");
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
