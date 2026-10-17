import "server-only";

import { redirect } from "next/navigation";
import { getOwnerEmail, getSupabaseConfig } from "./supabase/config";
import { createClient } from "./supabase/server";

export type DeskUser = { id: string; email: string; displayName: string };

export async function getDeskUser(): Promise<DeskUser | null> {
  const ownerEmail = getOwnerEmail();
  if (!getSupabaseConfig() || !ownerEmail) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user?.email || user.email.trim().toLowerCase() !== ownerEmail) return null;

  const name = [user.user_metadata?.full_name, user.user_metadata?.name]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return { id: user.id, email: user.email, displayName: name?.trim() || user.email };
}

export async function requireDeskUser(): Promise<DeskUser> {
  if (!getSupabaseConfig() || !getOwnerEmail()) redirect("/setup");
  const user = await getDeskUser();
  if (!user) redirect("/login");
  return user;
}
