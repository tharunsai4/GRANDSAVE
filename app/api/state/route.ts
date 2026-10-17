import type { SupabaseClient } from "@supabase/supabase-js";
import { getDeskUser } from "../../../lib/auth";
import { isDeskState } from "../../../lib/desk-state-validation";
import { getOwnerEmail, getSupabaseConfig } from "../../../lib/supabase/config";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;
const MAX_VERSION = 2_147_483_647;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

function conflict() {
  return json({ error: "This desk changed in another tab. Reload to see the latest version." }, 409);
}

type Access = { client: SupabaseClient; ownerId: string } | { response: Response };

async function getAccess(): Promise<Access> {
  const ownerEmail = getOwnerEmail();
  if (!getSupabaseConfig() || !ownerEmail) {
    return { response: json({ error: "The desk is not configured. Complete the Supabase and owner email settings." }, 503) };
  }

  try {
    // This identity comes from Supabase's verified session, never request headers.
    const user = await getDeskUser();
    const client = await createClient();
    if (!user) {
      const { data, error } = await client.auth.getUser();
      if (data.user) {
        return { response: json({ error: "This account is not the configured desk owner." }, 403) };
      }
      if (error && error.status && error.status >= 500) {
        return { response: json({ error: "Sign-in could not be checked. Please try again." }, 503) };
      }
      return { response: json({ error: "Sign in required." }, 401) };
    }
    if (user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
      return { response: json({ error: "This account is not the configured desk owner." }, 403) };
    }
    return { client, ownerId: user.id };
  } catch {
    return { response: json({ error: "Sign-in could not be checked. Please try again." }, 503) };
  }
}

function databaseError(error: { code?: string }, action: "load" | "save") {
  if (error.code === "42P01" || error.code === "PGRST205") {
    return json({ error: "The database is not ready. Apply the supplied Supabase migration and retry." }, 503);
  }
  if (error.code === "42501") {
    return json({ error: "Database access was denied. Check the Supabase policies and owner settings." }, 403);
  }
  if (["PGRST301", "PGRST302", "PGRST303"].includes(error.code ?? "")) {
    return json({ error: "Your session has expired. Sign in again." }, 401);
  }
  return json({ error: action === "load"
    ? "Your saved desk could not be loaded. Please try again."
    : "The save could not be confirmed. Reload before making more changes." }, 503);
}

export async function GET() {
  const access = await getAccess();
  if ("response" in access) return access.response;

  try {
    const { data, error } = await access.client.from("desk_states")
      .select("payload,version")
      .eq("owner_id", access.ownerId)
      .maybeSingle();
    if (error) return databaseError(error, "load");

    if (!data) {
      return json({
        state: {
          products: [], offers: [], orders: [], payments: [],
          settings: { businessName: "GrandSave", contactName: "", email: "", phone: "" },
        },
        version: 0,
      });
    }
    if (!isDeskState(data.payload) || !Number.isInteger(data.version) || data.version < 1 || data.version > MAX_VERSION) {
      // Never replace an unreadable saved workspace with an empty workspace.
      return json({ error: "The saved desk could not be read. Check the database before saving any changes." }, 503);
    }
    return json({ state: data.payload, version: data.version });
  } catch {
    return databaseError({}, "load");
  }
}

class BodyTooLarge extends Error {}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) throw new SyntaxError("Missing JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    // Next.js can reconstruct request.url using its internal server hostname.
    // Use the browser-facing Host header, as the server action origin check
    // does, so ordinary saves also work behind the Vercel proxy.
    try {
      const source = new URL(origin);
      const host = request.headers.get("host") ?? new URL(request.url).host;
      const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim()
        ?? new URL(request.url).protocol.replace(":", "");
      if (source.origin !== origin || source.host !== host || source.protocol !== `${protocol}:`) {
        return json({ error: "Save requests must come from this website." }, 403);
      }
    } catch {
      return json({ error: "Save requests must come from this website." }, 403);
    }
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Send the workspace as application/json." }, 415);
  }

  const access = await getAccess();
  if ("response" in access) return access.response;

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return error instanceof BodyTooLarge
      ? json({ error: "Workspace is too large. Keep saved data below 1 MB." }, 413)
      : json({ error: "Invalid JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid workspace data." }, 400);
  }
  const { state, version } = body as Record<string, unknown>;
  if (!isDeskState(state) || typeof version !== "number" || !Number.isInteger(version) || version < 0 || version >= MAX_VERSION) {
    return json({ error: "Invalid workspace data or version." }, 400);
  }

  const nextVersion = version + 1;
  const values = { payload: state, version: nextVersion, updated_at: new Date().toISOString() };
  try {
    if (version === 0) {
      const { data, error } = await access.client.from("desk_states")
        .insert({ owner_id: access.ownerId, ...values })
        .select("version")
        .single();
      if (error?.code === "23505") return conflict();
      if (error) return databaseError(error, "save");
      if (!data || data.version !== nextVersion) return databaseError({}, "save");
    } else {
      // A single conditional UPDATE prevents two tabs overwriting one another.
      const { data, error } = await access.client.from("desk_states")
        .update(values)
        .eq("owner_id", access.ownerId)
        .eq("version", version)
        .select("version")
        .maybeSingle();
      if (error) return databaseError(error, "save");
      if (!data) return conflict();
      if (data.version !== nextVersion) return databaseError({}, "save");
    }
    return json({ version: nextVersion });
  } catch {
    return databaseError({}, "save");
  }
}
