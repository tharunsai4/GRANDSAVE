// Local HTTP test double only. These credentials never reach a real service.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const fixturePassword = "FAKE_LOCAL_PORTAL_PASSWORD";
export const fixturePublicKey = "sb_publishable_FAKE_PORTAL_HTTP_TEST_KEY";
export const fixtureServiceKey = "FAKE_PORTAL_HTTP_SERVICE_ROLE_KEY";
export const owner = { id: "10000000-0000-4000-8000-000000000001", email: "owner@portal.example.test" };
export const customer = { id: "20000000-0000-4000-8000-000000000001", email: "shop-one@customers.grandsave.invalid" };
export const anotherCustomer = { id: "20000000-0000-4000-8000-000000000002", email: "shop-two@customers.grandsave.invalid" };
export const pendingCustomer = { id: "20000000-0000-4000-8000-000000000003", email: "pending@customers.grandsave.invalid" };
export const productId = "30000000-0000-4000-8000-000000000001";
export const archivedProductId = "30000000-0000-4000-8000-000000000002";
export const firstOrderId = "40000000-0000-4000-8000-000000000001";
export const secondOrderId = "40000000-0000-4000-8000-000000000002";

function reply(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" });
  response.end(JSON.stringify(body));
}
async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "null");
}
function authUser(account) {
  return {
    id: account.id, email: account.email, aud: "authenticated", role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: account.metadata,
    email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}
function accessToken(account, url) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: account.id, email: account.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, iss: `${url}/auth/v1`, session_id: randomUUID() })}`;
  return `${unsigned}.${createHmac("sha256", "FAKE_PORTAL_HTTP_SIGNING_KEY").update(unsigned).digest("base64url")}`;
}

export async function startPortalFixture() {
  const fixture = { users: new Map(), profiles: new Map(), tokens: new Map(), requests: [], tables: {}, url: "", roleError: null, enableError: null };
  const owners = new Set([owner.id]);
  function roleFor(account) {
    if (!account) return "anonymous";
    if (owners.has(account.id)) return "owner";
    const profile = fixture.profiles.get(account.id);
    return profile?.access_enabled && profile.approved ? "customer" : "pending";
  }
  fixture.reset = () => {
    fixture.users.clear(); fixture.profiles.clear(); fixture.requests.length = 0;
    fixture.roleError = null; fixture.enableError = null;
    for (const [index, account] of [owner, customer, anotherCustomer, pendingCustomer].entries()) {
      fixture.users.set(account.id, { ...account, password: fixturePassword, metadata: { name: `Account ${index}`, role: "owner", approved: true } });
      fixture.profiles.set(account.id, { id: account.id, name: `Account ${index}`, business_name: `Business ${index}`, email: `contact-${index}@example.test`, phone: "", address: "", access_key: index === 1 ? "shop-one" : index === 2 ? "shop-two" : null, access_enabled: index === 1 || index === 2, approved: index !== 3, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    }
    const now = Date.now();
    fixture.tables = {
      wholesale_products: [
        { id: productId, code: "ACTIVE", name: "Active product", category: "Food", pack: "Case of 6", units: 6, price: 12, rrp: 3, image: "", active: true },
        { id: archivedProductId, code: "ARCHIVED", name: "Archived product", category: "Food", pack: "Case", units: 1, price: 9, rrp: 0, image: "", active: false },
      ],
      wholesale_offers: [
        { id: "50000000-0000-4000-8000-000000000001", product_id: productId, price: 10, starts_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString() },
        { id: "50000000-0000-4000-8000-000000000002", product_id: productId, price: 8, starts_at: new Date(now - 3600000).toISOString(), ends_at: new Date(now - 60000).toISOString() },
      ],
      wholesale_orders: [
        { id: firstOrderId, reference: "FIRST", customer_id: customer.id, date: "2026-10-18", status: "Placed", total: 10, notes: "", created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z" },
        { id: secondOrderId, reference: "SECOND", customer_id: anotherCustomer.id, date: "2026-10-18", status: "Placed", total: 20, notes: "", created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z" },
      ],
      wholesale_order_items: [
        { id: "60000000-0000-4000-8000-000000000001", order_id: firstOrderId, product_id: productId, name: "First item", code: "ACTIVE", pack: "Case", quantity: 1, unit_price: 10 },
        { id: "60000000-0000-4000-8000-000000000002", order_id: secondOrderId, product_id: productId, name: "Second item", code: "ACTIVE", pack: "Case", quantity: 2, unit_price: 10 },
      ],
      wholesale_payments: [
        { id: "70000000-0000-4000-8000-000000000001", order_id: firstOrderId, amount: 2, method: "Cash", date: "2026-10-18", note: "" },
        { id: "70000000-0000-4000-8000-000000000002", order_id: secondOrderId, amount: 3, method: "Cash", date: "2026-10-18", note: "" },
      ],
      wholesale_settings: [{ id: true, business_name: "GrandSave", contact_name: "", email: "", phone: "", require_customer_approval: false }],
    };
    for (const table of Object.values(fixture.tables)) {
      for (const row of table) {
        if (typeof row.id !== "boolean") {
          row.created_at ??= new Date(now - 3600000).toISOString();
          row.updated_at ??= row.created_at;
        }
      }
    }
    for (const order of fixture.tables.wholesale_orders) order.request_id ??= null;
  };
  fixture.reset();
  function visibleRows(table, account) {
    const role = roleFor(account);
    let rows = table === "wholesale_customers" ? [...fixture.profiles.values()] : fixture.tables[table] ?? [];
    if (role === "owner") return rows;
    if (table === "wholesale_customers") return rows.filter(row => row.id === account.id);
    if (table === "wholesale_settings") return rows;
    if (role !== "customer") return [];
    if (table === "wholesale_products") return rows.filter(row => row.active);
    if (table === "wholesale_offers") return rows.filter(row => new Date(row.starts_at).getTime() <= Date.now() && new Date(row.ends_at).getTime() > Date.now() && fixture.tables.wholesale_products.some(product => product.id === row.product_id && product.active));
    if (table === "wholesale_orders") return rows.filter(row => row.customer_id === account.id);
    const ownOrders = new Set(fixture.tables.wholesale_orders.filter(row => row.customer_id === account.id).map(row => row.id));
    return rows.filter(row => ownOrders.has(row.order_id));
  }
  function filterRows(rows, parameters) {
    for (const [field, condition] of parameters) {
      if (condition.startsWith("eq.")) rows = rows.filter(row => String(row[field]) === condition.slice(3));
      if (condition.startsWith("neq.")) rows = rows.filter(row => String(row[field]) !== condition.slice(4));
    }
    return rows;
  }
  function createOrder(customerId, lines, { notes = "", status = "Placed", date = new Date().toISOString().slice(0, 10), requestId = null } = {}) {
    const timestamp = new Date().toISOString();
    const orderId = randomUUID();
    const items = lines.map(line => {
      const product = fixture.tables.wholesale_products.find(row => row.id === line.product_id && row.active);
      if (!product) throw new Error("Choose an active product");
      const prices = fixture.tables.wholesale_offers.filter(row => row.product_id === product.id && Date.parse(row.starts_at) <= Date.now() && Date.parse(row.ends_at) > Date.now()).map(row => row.price);
      const unitPrice = Math.min(product.price, ...prices);
      return { id: randomUUID(), order_id: orderId, product_id: product.id, name: product.name, code: product.code, pack: product.pack, quantity: line.quantity, unit_price: unitPrice };
    });
    const order = { id: orderId, customer_id: customerId, request_id: requestId, reference: `GS-FIXTURE-${fixture.tables.wholesale_orders.length + 1}`, date, status, notes, total: Math.round(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0) * 100) / 100, created_at: timestamp, updated_at: timestamp };
    fixture.tables.wholesale_orders.push(order);
    fixture.tables.wholesale_order_items.push(...items);
    return order;
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, fixture.url);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const account = fixture.users.get(fixture.tokens.get(token));
      const body = request.method === "POST" || request.method === "PUT" || request.method === "PATCH" ? await readBody(request) : null;
      const entry = { method: request.method, path: url.pathname, body, userId: account?.id, admin: token === fixtureServiceKey };
      fixture.requests.push(entry);
      if (url.pathname === "/auth/v1/token" && request.method === "POST") {
        const user = [...fixture.users.values()].find(value => value.email === body.email && value.password === body.password);
        if (url.searchParams.get("grant_type") !== "password" || !user) return reply(response, 400, { code: "invalid_credentials", msg: "Invalid fixture credentials" });
        const token = accessToken(user, fixture.url); fixture.tokens.set(token, user.id);
        return reply(response, 200, { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `FAKE_REFRESH_${user.id}`, user: authUser(user) });
      }
      if (url.pathname === "/auth/v1/user") return account ? reply(response, 200, authUser(account)) : reply(response, 401, { code: "bad_jwt", msg: "Invalid fixture session" });
      if (url.pathname === "/auth/v1/logout") return reply(response, 200, {});
      if (url.pathname.startsWith("/auth/v1/admin/users")) {
        if (token !== fixtureServiceKey) return reply(response, 403, { message: "Admin credentials required" });
        if (url.pathname === "/auth/v1/admin/users" && request.method === "POST") {
          if ([...fixture.users.values()].some(value => value.email === body.email)) return reply(response, 422, { code: "email_exists", msg: "Duplicate fixture email" });
          const user = { id: randomUUID(), email: body.email, password: body.password, metadata: body.user_metadata ?? {} };
          fixture.users.set(user.id, user);
          fixture.profiles.set(user.id, { id: user.id, name: user.metadata.name || "", business_name: user.metadata.business_name || "", email: user.metadata.contact_email || "", phone: user.metadata.phone || "", address: user.metadata.address || "", access_key: null, access_enabled: false, approved: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          return reply(response, 200, { user: authUser(user) });
        }
        const id = url.pathname.split("/").at(-1);
        if (request.method === "DELETE") { fixture.users.delete(id); fixture.profiles.delete(id); return reply(response, 200, {}); }
        if (request.method === "PUT") {
          const user = fixture.users.get(id);
          if (!user) return reply(response, 404, { message: "User not found" });
          user.password = body.password; return reply(response, 200, { user: authUser(user) });
        }
      }
      if (!account) return reply(response, 401, { code: "PGRST301", message: "Session required" });
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").at(-1);
        if (name === "wholesale_role") return fixture.roleError ? reply(response, 404, fixture.roleError) : reply(response, 200, roleFor(account));
        if (name === "wholesale_enable_customer") {
          if (roleFor(account) !== "owner") return reply(response, 403, { code: "42501", message: "Owner only" });
          if (fixture.enableError) return reply(response, 400, fixture.enableError);
          const profile = fixture.profiles.get(body.p_customer_id);
          if (!profile || owners.has(body.p_customer_id)) return reply(response, 400, { code: "22023", message: "Choose a customer" });
          if ([...fixture.profiles.values()].some(row => row.id !== profile.id && row.access_key === body.p_access_key)) return reply(response, 409, { code: "23505", message: "Access key already in use" });
          profile.access_key = body.p_access_key; profile.access_enabled = true;
          // Explicit owner provisioning approves access even if the generic
          // approval setting is enabled; the owner has just authorized it.
          profile.approved = true;
          profile.updated_at = new Date().toISOString();
          return reply(response, 200, null);
        }
        if (name === "wholesale_can_manage_customer") {
          if (roleFor(account) !== "owner") return reply(response, 403, { code: "42501", message: "Owner only" });
          return reply(response, 200, !owners.has(body.p_customer_id) && Boolean(fixture.profiles.get(body.p_customer_id)?.access_enabled));
        }
        if (name === "wholesale_place_order") {
          if (roleFor(account) !== "customer") return reply(response, 403, { code: "42501", message: "Customer access required" });
          let order = fixture.tables.wholesale_orders.find(row => row.customer_id === account.id && row.request_id === body.p_request_id);
          if (!order) order = createOrder(account.id, body.p_items, { notes: body.p_notes, requestId: body.p_request_id });
          return reply(response, 200, order.id);
        }
        if (name === "wholesale_update_profile") {
          const profile = fixture.profiles.get(account.id);
          Object.assign(profile, { name: body.p_name, business_name: body.p_business_name, phone: body.p_phone, address: body.p_address, updated_at: new Date().toISOString() });
          return reply(response, 200, null);
        }
        if (["wholesale_owner_order", "wholesale_set_order_status", "wholesale_record_payment", "wholesale_set_customer_approval"].includes(name)) {
          if (roleFor(account) !== "owner") return reply(response, 403, { code: "42501", message: "Owner only" });
          if (name === "wholesale_owner_order") {
            if (!fixture.profiles.get(body.p_customer_id)?.access_enabled || owners.has(body.p_customer_id)) return reply(response, 400, { code: "22023", message: "Choose an enabled customer" });
            return reply(response, 200, createOrder(body.p_customer_id, body.p_items, { notes: body.p_notes, status: body.p_status, date: body.p_date }).id);
          }
          if (name === "wholesale_set_customer_approval") {
            const profile = fixture.profiles.get(body.p_customer_id);
            if (!profile || owners.has(profile.id)) return reply(response, 400, { code: "22023", message: "Choose a customer" });
            profile.approved = body.p_approved; profile.updated_at = new Date().toISOString();
            return reply(response, 200, null);
          }
          const order = fixture.tables.wholesale_orders.find(row => row.id === body.p_order_id);
          if (!order) return reply(response, 400, { code: "22023", message: "Choose an order" });
          const paid = fixture.tables.wholesale_payments.filter(row => row.order_id === order.id).reduce((sum, row) => sum + row.amount, 0);
          if (name === "wholesale_set_order_status") {
            if (paid > 0 && ["Draft", "Cancelled"].includes(body.p_status)) return reply(response, 400, { code: "22023", message: "Paid orders cannot be cancelled or made draft" });
            order.status = body.p_status; order.updated_at = new Date().toISOString();
            return reply(response, 200, null);
          }
          if (["Draft", "Cancelled"].includes(order.status) || body.p_amount <= 0 || body.p_amount > order.total - paid) return reply(response, 400, { code: "22023", message: "Payment exceeds the available order balance" });
          const payment = { id: randomUUID(), order_id: order.id, amount: body.p_amount, method: body.p_method, date: body.p_date, note: body.p_note, created_at: new Date().toISOString() };
          fixture.tables.wholesale_payments.push(payment);
          return reply(response, 200, payment.id);
        }
        return reply(response, 404, { code: "PGRST202", message: "Unknown fixture RPC" });
      }
      if (url.pathname.startsWith("/rest/v1/") && request.method === "GET") {
        const table = url.pathname.split("/").at(-1);
        let rows = visibleRows(table, account);
        rows = filterRows(rows, url.searchParams);
        rows = rows.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 500));
        return reply(response, 200, request.headers.accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows);
      }
      if (url.pathname.startsWith("/rest/v1/") && ["POST", "PATCH", "DELETE"].includes(request.method)) {
        if (roleFor(account) !== "owner") return reply(response, 403, { code: "42501", message: "Owner only" });
        const table = url.pathname.split("/").at(-1);
        if (!["wholesale_products", "wholesale_offers", "wholesale_settings"].includes(table)) return reply(response, 403, { code: "42501", message: "Table writes not allowed" });
        let changed;
        if (request.method === "POST") {
          const timestamp = new Date().toISOString();
          const row = { ...body, id: randomUUID(), created_at: timestamp, updated_at: timestamp };
          fixture.tables[table].push(row); changed = [row];
        } else {
          changed = filterRows(fixture.tables[table], url.searchParams);
          if (request.method === "PATCH") for (const row of changed) Object.assign(row, body);
          else fixture.tables[table] = fixture.tables[table].filter(row => !changed.includes(row));
        }
        return reply(response, 200, request.headers.accept?.includes("vnd.pgrst.object") ? changed[0] ?? null : changed);
      }
      return reply(response, 404, { message: `Unexpected fixture route ${request.method} ${url.pathname}` });
    } catch (error) { reply(response, 500, { code: "FIXTURE_FAILURE", message: String(error) }); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  fixture.url = `http://127.0.0.1:${server.address().port}`;
  fixture.cookieFor = async account => {
    const jar = new Map();
    const client = createServerClient(fixture.url, fixturePublicKey, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) } });
    const { error } = await client.auth.signInWithPassword({ email: account.email, password: fixturePassword });
    assert.ifError(error); assert.ok(jar.size);
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  };
  fixture.close = async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); };
  return fixture;
}

export async function startPortalApp(fixture, overrides = {}) {
  await access(join(projectRoot, ".next", "BUILD_ID")).catch(() => { throw new Error("Run npm run build before the portal HTTP tests."); });
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const child = spawn(process.execPath, [join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: fixture.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixturePublicKey, NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: fixtureServiceKey, OWNER_EMAIL: "not-authority@example.test", NEXT_TELEMETRY_DISABLED: "1", ...overrides },
  });
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-12000); }); child.stderr.on("data", chunk => { output = (output + chunk).slice(-12000); });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 5000); timer.unref(); await exited; clearTimeout(timer);
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Portal server stopped: ${output}`);
      try { if ((await fetch(`${url}/login`, { signal: AbortSignal.timeout(1000) })).status < 500) return { url, close, output: () => output }; } catch { /* Wait for the local process to bind. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Portal server failed to start: ${output}`);
  } catch (error) { await close(); throw error; }
}
