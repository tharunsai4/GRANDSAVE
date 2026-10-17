import type { SupabaseClient } from "@supabase/supabase-js";
import { getPortalUser, PortalAccessError } from "../../../lib/auth";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { getSupabaseConfig } from "../../../lib/supabase/config";
import { accessKeyEmail, normalizeAccessKey } from "../../../lib/access-key";
import * as input from "../../../lib/portal-input";
import type { PortalData } from "../../../lib/portal-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
function json(body: unknown, status = 200) { return Response.json(body, { status, headers }); }

class ServiceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

function databaseError(error: { code?: string; message?: string }): never {
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? "")) {
    throw new ServiceError("The wholesale portal database is not ready. Apply migration 0002 and the owner setup SQL.");
  }
  if (error.code === "42501") throw new ServiceError("This account does not have permission for that action.", 403);
  if (error.code === "23505") throw new ServiceError("That code or access key is already in use. Choose another.", 409);
  if (["23503", "23514", "22003", "22P02"].includes(error.code ?? "")) throw new ServiceError("The details could not be saved. Check the selected records, prices and quantities.", 400);
  if (["22023", "P0001"].includes(error.code ?? "")) throw new ServiceError(error.message?.slice(0, 250) || "This action could not be completed.", 400);
  throw new ServiceError("The service could not confirm this request. Refresh your desk before trying again.");
}

function errorResponse(error: unknown) {
  if (error instanceof input.InputError) return json({ error: error.message }, 400);
  if (error instanceof ServiceError || error instanceof PortalAccessError) return json({ error: error.message }, error.status);
  return json({ error: "The wholesale service is unavailable. Please try again." }, 503);
}

async function rows(client: SupabaseClient, table: string, ownId?: string, excludeOwner = false) {
  const result: unknown[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    let query = client.from(table).select("*").order("id").range(offset, offset + 499);
    if (ownId) query = excludeOwner ? query.neq("id", ownId) : query.eq("id", ownId);
    const { data, error } = await query;
    if (error) databaseError(error);
    result.push(...(data ?? []));
    if (!data || data.length < 500) return result;
  }
  throw new ServiceError("There are too many records to load at once. Contact the owner for assistance.");
}

export async function GET() {
  try {
    if (!getSupabaseConfig()) throw new ServiceError("Connect Supabase in the deployment settings first.");
    const user = await getPortalUser();
    if (!user) return json({ error: "Sign in with your access key and password." }, 401);
    const client = await createClient();
    const owner = user.role === "owner";
    const pending = user.role === "pending";
    const [products, offers, customers, orders, items, payments, settingsResult] = await Promise.all([
      pending ? [] : rows(client, "wholesale_products"),
      pending ? [] : rows(client, "wholesale_offers"),
      rows(client, "wholesale_customers", user.id, owner),
      pending ? [] : rows(client, "wholesale_orders"),
      pending ? [] : rows(client, "wholesale_order_items"),
      pending ? [] : rows(client, "wholesale_payments"),
      client.from("wholesale_settings").select("*").eq("id", true).maybeSingle(),
    ]);
    if (settingsResult.error) databaseError(settingsResult.error);
    if (!settingsResult.data) throw new ServiceError("The business settings are missing. Apply the wholesale portal migration.");
    // Every query uses the verified user's JWT. Row policies independently
    // restrict customers to their own records and the active catalogue.
    return json({ user, products, offers, customers, orders, items, payments, settings: settingsResult.data } as PortalData);
  } catch (error) { return errorResponse(error); }
}

async function readBody(request: Request) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > 256_000) throw new ServiceError("This request is too large.", 413);
  if (!request.body) throw new input.InputError("Send valid JSON data.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) { await reader.cancel(); throw new ServiceError("This request is too large.", 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return input.record(JSON.parse(text));
  } catch (error) {
    if (error instanceof ServiceError || error instanceof input.InputError) throw error;
    throw new input.InputError("Send valid JSON data.");
  } finally { reader.releaseLock(); }
}

function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const source = new URL(origin);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(request.url).protocol.replace(":", "");
    if (source.origin === origin && source.host === host && source.protocol === `${protocol}:`) return;
  } catch { /* Reject malformed origins below. */ }
  throw new ServiceError("Requests must come from this website.", 403);
}

const statuses = ["Draft", "Placed", "Confirmed", "Packing", "Completed", "Cancelled"];
function status(value: unknown) {
  if (typeof value !== "string" || !statuses.includes(value)) throw new input.InputError("Choose a valid order status.");
  return value;
}

async function rpc(client: SupabaseClient, name: string, values: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, values);
  if (error) databaseError(error);
  return data;
}

async function createCustomer(client: SupabaseClient, body: Record<string, unknown>) {
  const key = normalizeAccessKey(input.text(body.access_key, "access key", 40, true));
  if (!key) throw new input.InputError("Use an access key with 4–40 letters, numbers, hyphens or underscores.");
  const password = input.password(body.password);
  const metadata = {
    name: input.text(body.name, "customer name", 200, true),
    business_name: input.text(body.business_name, "business name", 200),
    phone: input.text(body.phone, "phone number", 80),
    address: input.text(body.address, "address", 1000),
    contact_email: input.contactEmail(body.email),
  };
  let admin;
  try { admin = createAdminClient(); }
  catch { throw new ServiceError("Customer access setup is incomplete. Add the server-only SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy."); }
  const { data, error } = await admin.auth.admin.createUser({
    email: accessKeyEmail(key), password, email_confirm: true, user_metadata: metadata,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.code === "user_already_exists" || error?.code === "email_address_not_authorized") throw new ServiceError("That access key is already in use or unavailable. Choose another or reset the existing customer's password.", 409);
    if (error?.code === "weak_password" || error?.status === 422) throw new ServiceError("The password does not meet this project's requirements. Choose a stronger password.", 400);
    throw new ServiceError("The customer account could not be created. Check the Supabase user service and password settings.");
  }
  try {
    await rpc(client, "wholesale_enable_customer", { p_customer_id: data.user.id, p_access_key: key });
  } catch (error) {
    // Only roll back the brand-new Auth user created by this request.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw error;
  }
  return { id: data.user.id, access_key: key };
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ error: "Send JSON data." }, 415);
    if (!getSupabaseConfig()) throw new ServiceError("Connect Supabase in the deployment settings first.");
    const user = await getPortalUser();
    if (!user) return json({ error: "Sign in required." }, 401);
    const body = await readBody(request);
    const operation = input.text(body.operation, "action", 40, true);
    if (!["placeOrder", "updateProfile"].includes(operation) && user.role !== "owner") return json({ error: "Only the owner can perform this action." }, 403);
    const client = await createClient();
    let id: unknown;
    switch (operation) {
      case "placeOrder": {
        if (user.role !== "customer") throw new ServiceError("Your customer access is not active. Contact GrandSave.", 403);
        id = await rpc(client, "wholesale_place_order", {
          p_items: input.orderItems(body.items), p_notes: input.text(body.notes, "order notes", 4000),
          p_request_id: input.uuid(body.request_id, "checkout request"),
        });
        break;
      }
      case "createCustomer": return json({ ok: true, ...await createCustomer(client, body) });
      case "resetCustomerPassword": {
        const customerId = input.uuid(body.id, "customer");
        const password = input.password(body.password);
        const allowed = await rpc(client, "wholesale_can_manage_customer", { p_customer_id: customerId });
        if (allowed !== true) throw new ServiceError("Choose an owner-issued customer account. Owner passwords cannot be changed here.", 403);
        let admin;
        try { admin = createAdminClient(); } catch { throw new ServiceError("Add SUPABASE_SERVICE_ROLE_KEY in Vercel to manage customer passwords."); }
        const { error } = await admin.auth.admin.updateUserById(customerId, { password });
        if (error) throw new ServiceError("The password could not be reset. Check the password requirements and try again.");
        break;
      }
      case "saveProduct": {
        const p = input.record(body.product);
        if (typeof p.units !== "number" || !Number.isInteger(p.units) || p.units < 1 || p.units > 1_000_000) throw new input.InputError("Units per pack must be a positive whole number.");
        const image = input.text(p.image, "image URL", 5000);
        if (image) { try { if (!["https:", "http:"].includes(new URL(image).protocol)) throw new Error(); } catch { throw new input.InputError("Use a valid HTTP or HTTPS image URL."); } }
        const values = {
          code: input.text(p.code, "product code", 80, true), name: input.text(p.name, "product name", 200, true),
          category: input.text(p.category, "category", 120), pack: input.text(p.pack, "pack description", 160),
          units: p.units, price: input.amount(p.price, "pack price"), rrp: input.amount(p.rrp, "retail price"),
          image, active: input.bool(p.active, "product status"), updated_at: new Date().toISOString(),
        };
        const query = p.id ? client.from("wholesale_products").update(values).eq("id", input.uuid(p.id, "product")) : client.from("wholesale_products").insert(values);
        const result = await query.select("id").single();
        if (result.error) databaseError(result.error);
        id = result.data.id;
        break;
      }
      case "archiveProduct": {
        const result = await client.from("wholesale_products").update({ active: input.bool(body.active, "product status"), updated_at: new Date().toISOString() }).eq("id", input.uuid(body.id, "product")).select("id").single();
        if (result.error) databaseError(result.error);
        id = result.data.id;
        break;
      }
      case "saveOffer": {
        const offer = input.record(body.offer);
        const values = { product_id: input.uuid(offer.product_id, "product"), price: input.amount(offer.price, "offer price", true), starts_at: input.timestamp(offer.starts_at), ends_at: input.timestamp(offer.ends_at) };
        if (values.ends_at <= values.starts_at) throw new input.InputError("The offer must end after it starts.");
        const query = offer.id ? client.from("wholesale_offers").update(values).eq("id", input.uuid(offer.id, "offer")) : client.from("wholesale_offers").insert(values);
        const result = await query.select("id").single();
        if (result.error) databaseError(result.error);
        id = result.data.id;
        break;
      }
      case "deleteOffer": {
        const result = await client.from("wholesale_offers").delete().eq("id", input.uuid(body.id, "offer")).select("id").single();
        if (result.error) databaseError(result.error);
        break;
      }
      case "createOrder": id = await rpc(client, "wholesale_owner_order", { p_customer_id: input.uuid(body.customer_id, "customer"), p_items: input.orderItems(body.items), p_status: status(body.status), p_notes: input.text(body.notes, "order notes", 4000), p_date: input.date(body.date) }); break;
      case "setOrderStatus": await rpc(client, "wholesale_set_order_status", { p_order_id: input.uuid(body.id, "order"), p_status: status(body.status) }); break;
      case "recordPayment": id = await rpc(client, "wholesale_record_payment", { p_order_id: input.uuid(body.order_id, "order"), p_amount: input.amount(body.amount, "payment amount", true), p_method: input.text(body.method, "payment method", 100, true), p_date: input.date(body.date), p_note: input.text(body.note, "payment note", 2000) }); break;
      case "approveCustomer": await rpc(client, "wholesale_set_customer_approval", { p_customer_id: input.uuid(body.id, "customer"), p_approved: input.bool(body.approved, "customer access") }); break;
      case "updateProfile": await rpc(client, "wholesale_update_profile", { p_name: input.text(body.name, "name", 200, true), p_business_name: input.text(body.business_name, "business name", 200), p_phone: input.text(body.phone, "phone number", 80), p_address: input.text(body.address, "address", 1000) }); break;
      case "updateSettings": {
        const result = await client.from("wholesale_settings").update({ business_name: input.text(body.business_name, "business name", 200, true), contact_name: input.text(body.contact_name, "contact name", 200), email: input.contactEmail(body.email), phone: input.text(body.phone, "phone number", 80), require_customer_approval: input.bool(body.require_customer_approval, "customer approval setting") }).eq("id", true).select("id").single();
        if (result.error) databaseError(result.error);
        break;
      }
      default: throw new input.InputError("Choose a supported action.");
    }
    return json({ ok: true, ...(typeof id === "string" ? { id } : {}) });
  } catch (error) { return errorResponse(error); }
}
