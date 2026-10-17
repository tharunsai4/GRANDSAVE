import "server-only";

export type SupabaseConfig = { url: string; key: string };

function getSupabaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return url;
}

function getSupabaseKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  return url && key ? { url, key } : null;
}

// Setup guidance only; this value never grants an application role.
export function getOwnerEmail(): string | null {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return email || null;
}

export function getMissingSupabaseVariables(): string[] {
  const missing: string[] = [];
  if (!getSupabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!getSupabaseKey()) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}
