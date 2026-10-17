import "server-only";

import { redirect } from "next/navigation";
import type { PortalUser } from "./portal-types";
import { getSupabaseConfig } from "./supabase/config";
import { createClient } from "./supabase/server";

export type DeskUser = { id: string; email: string; displayName: string };

export class PortalAccessError extends Error {
  readonly status = 503;
  constructor(readonly kind: "setup" | "service") {
    super(kind === "setup"
      ? "The wholesale database needs its portal setup migration. Ask the administrator to complete database setup."
      : "The sign-in service is temporarily unavailable. Please try again shortly.");
    this.name = "PortalAccessError";
  }
}

export async function getPortalUser(): Promise<PortalUser | null> {
  if (!getSupabaseConfig()) return null;
  const supabase = await createClient();
  let result;
  try {
    result = await supabase.auth.getUser();
  } catch {
    throw new PortalAccessError("service");
  }
  if (result.error) {
    if (!result.error.status || result.error.status >= 500) throw new PortalAccessError("service");
    return null;
  }
  const user = result.data.user;
  if (!user?.email) return null;

  let roleResult;
  try {
    roleResult = await supabase.rpc("wholesale_role");
  } catch {
    throw new PortalAccessError("service");
  }
  if (roleResult.error) {
    const missingSetup = ["42883", "42P01", "PGRST202", "PGRST205", "42501"].includes(roleResult.error.code);
    throw new PortalAccessError(missingSetup ? "setup" : "service");
  }
  const role = roleResult.data;
  if (role !== "owner" && role !== "customer" && role !== "pending") return null;

  const name = [user.user_metadata?.full_name, user.user_metadata?.name, user.user_metadata?.business_name]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const internalCustomer = user.email.toLowerCase().endsWith("@customers.grandsave.invalid");
  return {
    id: user.id,
    email: user.email,
    displayName: name?.trim() || (internalCustomer ? "Customer" : user.email),
    role,
  };
}

export async function requirePortalUser(): Promise<PortalUser> {
  if (!getSupabaseConfig()) redirect("/setup");
  let user: PortalUser | null;
  try {
    user = await getPortalUser();
  } catch (error) {
    if (error instanceof PortalAccessError) redirect(`/login?error=${error.kind === "setup" ? "portal-setup" : "unavailable"}`);
    throw error;
  }
  if (!user) redirect("/login");
  return user;
}

// Compatibility for legacy desk routes: only protected database owners qualify.
export async function getDeskUser(): Promise<DeskUser | null> {
  const user = await getPortalUser();
  return user?.role === "owner" ? { id: user.id, email: user.email, displayName: user.displayName } : null;
}

export async function requireDeskUser(): Promise<DeskUser> {
  const user = await requirePortalUser();
  if (user.role !== "owner") redirect("/");
  return { id: user.id, email: user.email, displayName: user.displayName };
}
