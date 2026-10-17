import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        for (const cookie of previousCookies) response.cookies.set(cookie);
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    // Pages and APIs verify the user separately. An unavailable Auth service
    // must never grant access or prevent the setup/login views from rendering.
  }

  response.headers.set("Cache-Control", "private, no-store");
  // Return this response so refreshed cookies reach the browser, including
  // when the page subsequently redirects to sign in.
  return response;
}
