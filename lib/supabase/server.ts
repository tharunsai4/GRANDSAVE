import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

export async function createClient(): Promise<SupabaseClient> {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured. Complete the steps at /setup.");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The Proxy refreshes them
          // before rendering; actions and route handlers can write them here.
        }
      },
    },
  });
}
