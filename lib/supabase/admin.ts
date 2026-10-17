import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

// Used only by owner-authorized customer provisioning and password reset.
// Catalogue, order and payment operations always use the signed-in user's JWT.
export function createAdminClient() {
  const config = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) {
    throw new Error("Customer access is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
  }
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
