import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { startPortalApp, startPortalFixture, owner, customer, anotherCustomer, pendingCustomer, productId, firstOrderId, fixturePassword, fixtureServiceKey } from "./portal-http-fixture.mjs";

// Real Next.js HTTP routes and real Supabase SDK; remote Auth/PostgREST are local
// test doubles. The separate SQL suite verifies actual RLS/RPC enforcement.
describe("wholesale portal HTTP authorization and customer credentials", { timeout: 120000 }, () => {
  let fixture, app, ownerCookie, customerCookie, pendingCookie;
  before(async () => {
    fixture = await startPortalFixture();
    [ownerCookie, customerCookie, pendingCookie] = await Promise.all([fixture.cookieFor(owner), fixture.cookieFor(customer), fixture.cookieFor(pendingCustomer)]);
    app = await startPortalApp(fixture);
  });
  after(async () => { await app?.close(); await fixture?.close(); });
  beforeEach(() => fixture.reset());

  function request(body, cookie = ownerCookie, headers = {}) {
    return fetch(`${app.url}/api/portal`, { method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  }
  function createBody(overrides = {}) {
    return { operation: "createCustomer", name: "New customer", business_name: "New business", access_key: " New-Shop ", password: fixturePassword, email: "contact@example.test", phone: "", address: "", ...overrides };
  }
  function adminCalls() { return fixture.requests.filter(row => row.path.startsWith("/auth/v1/admin/")); }

  it("rejects anonymous and forged identity-header requests", async () => {
    assert.equal((await request(undefined, null)).status, 401);
    assert.equal((await request(undefined, null, { "oai-authenticated-user-id": owner.id, "oai-authenticated-user-email": owner.email })).status, 401);
    assert.equal((await request(createBody(), null)).status, 401);
    assert.equal(adminCalls().length, 0);
  });

  it("returns customer-only records and active catalogue using the verified JWT", async () => {
    const response = await request(undefined, customerCookie); assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.user.role, "customer"); assert.equal(data.user.id, customer.id);
    assert.deepEqual(data.customers.map(row => row.id), [customer.id]);
    assert.deepEqual(data.products.map(row => row.id), [productId]); assert.equal(data.offers.length, 1);
    assert.deepEqual(data.orders.map(row => row.id), [firstOrderId]);
    assert.ok(data.items.every(row => row.order_id === firstOrderId)); assert.ok(data.payments.every(row => row.order_id === firstOrderId));
    assert.ok(!JSON.stringify(data).includes(anotherCustomer.email));
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.ok(fixture.requests.filter(row => row.path.startsWith("/rest/")).every(row => row.userId === customer.id && !row.admin));
  });

  it("uses the protected role rather than email or metadata, and excludes owner profile from customer selector", async () => {
    const response = await request(); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.user.role, "owner");
    assert.equal(data.products.length, 2); assert.equal(data.orders.length, 2);
    assert.ok(!data.customers.some(row => row.id === owner.id));
    const pending = await (await request(undefined, pendingCookie)).json();
    assert.equal(pending.user.role, "pending"); assert.deepEqual(pending.products, []); assert.deepEqual(pending.orders, []);
    assert.deepEqual(pending.customers.map(row => row.id), [pendingCustomer.id]);
    assert.equal((await request({ operation: "placeOrder", items: [{ product_id: productId, quantity: 1 }], request_id: randomUUID() }, pendingCookie)).status, 403);
  });

  it("denies every owner-only operation before customer payloads reach admin services", async () => {
    for (const operation of ["createCustomer", "resetCustomerPassword", "saveProduct", "archiveProduct", "saveOffer", "deleteOffer", "createOrder", "setOrderStatus", "recordPayment", "approveCustomer", "updateSettings"]) {
      assert.equal((await request({ operation }, customerCookie)).status, 403, operation);
    }
    assert.equal(adminCalls().length, 0);
  });

  it("creates confirmed customer Auth credentials, then enables access through the owner RPC", async () => {
    fixture.tables.wholesale_settings[0].require_customer_approval = true;
    const response = await request(createBody()); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.access_key, "new-shop");
    const creation = adminCalls().find(row => row.method === "POST");
    assert.equal(creation.body.email, "new-shop@customers.grandsave.invalid"); assert.equal(creation.body.email_confirm, true);
    assert.equal(creation.body.password, fixturePassword); assert.equal(creation.body.user_metadata.contact_email, "contact@example.test");
    assert.equal(creation.body.user_metadata.role, undefined); assert.equal(creation.body.user_metadata.access_enabled, undefined);
    const enable = fixture.requests.find(row => row.path.endsWith("/wholesale_enable_customer"));
    assert.equal(enable.userId, owner.id); assert.equal(enable.admin, false);
    assert.deepEqual(enable.body, { p_customer_id: result.id, p_access_key: "new-shop" });
    assert.equal(fixture.profiles.get(result.id).access_enabled, true);
    assert.equal(fixture.profiles.get(result.id).approved, true);
    assert.equal(fixture.profiles.get(result.id).email, "contact@example.test");
    assert.ok(!JSON.stringify(result).includes(fixturePassword)); assert.ok(!JSON.stringify(result).includes(fixtureServiceKey));
  });

  it("rejects malformed keys and weak passwords before creating Auth users", async () => {
    for (const body of [createBody({ access_key: "bad@key" }), createBody({ access_key: "abc" }), createBody({ password: "short" })]) assert.equal((await request(body)).status, 400);
    assert.equal(adminCalls().length, 0);
  });

  it("reports duplicate access keys without deleting or enabling an existing account", async () => {
    assert.equal((await request(createBody({ access_key: "shop-one" }))).status, 409);
    assert.ok(fixture.users.has(customer.id));
    assert.equal(adminCalls().filter(row => row.method === "DELETE").length, 0);
    assert.equal(fixture.requests.filter(row => row.path.endsWith("/wholesale_enable_customer")).length, 0);
  });

  it("rolls back only the newly created Auth user when owner enable fails", async () => {
    fixture.enableError = { code: "22023", message: "Customer could not be enabled" };
    assert.equal((await request(createBody())).status, 400);
    const removed = adminCalls().filter(row => row.method === "DELETE"); assert.equal(removed.length, 1);
    const removedId = removed[0].path.split("/").at(-1);
    assert.ok(![owner.id, customer.id, anotherCustomer.id, pendingCustomer.id].includes(removedId));
    assert.ok(!fixture.users.has(removedId)); assert.ok(fixture.users.has(owner.id)); assert.ok(fixture.users.has(customer.id));
  });

  it("resets only enabled customer passwords after a protected owner check", async () => {
    const body = { operation: "resetCustomerPassword", id: customer.id, password: "FAKE_REPLACEMENT_PASSWORD" };
    assert.equal((await request(body, customerCookie)).status, 403);
    assert.equal((await request({ ...body, id: owner.id })).status, 403);
    assert.equal(adminCalls().length, 0);
    assert.equal((await request(body)).status, 200);
    assert.equal(fixture.users.get(customer.id).password, body.password);
    const update = adminCalls().find(row => row.method === "PUT"); assert.equal(update.path, `/auth/v1/admin/users/${customer.id}`);
    assert.ok(fixture.requests.some(row => row.path.endsWith("/wholesale_can_manage_customer") && row.userId === owner.id && !row.admin));
  });

  it("strips caller price/customer authority from checkout requests and keeps retry IDs", async () => {
    const requestId = randomUUID();
    const body = { operation: "placeOrder", request_id: requestId, customer_id: anotherCustomer.id, items: [{ product_id: productId, quantity: 2, unit_price: 0 }], notes: "Deliver please", total: 0 };
    const first = await request(body, customerCookie); assert.equal(first.status, 200); const result = await first.json();
    const second = await request(body, customerCookie); assert.equal((await second.json()).id, result.id);
    const call = fixture.requests.find(row => row.path.endsWith("/wholesale_place_order"));
    assert.deepEqual(call.body, { p_items: [{ product_id: productId, quantity: 2 }], p_notes: "Deliver please", p_request_id: requestId });
    assert.equal(fixture.tables.wholesale_orders.find(row => row.id === result.id).customer_id, customer.id);
  });

  it("rejects cross-origin and non-JSON writes before provisioning", async () => {
    assert.equal((await request(createBody(), ownerCookie, { Origin: "https://attacker.example.test" })).status, 403);
    assert.equal((await request("{}", ownerCookie, { "Content-Type": "text/plain" })).status, 415);
    assert.equal(adminCalls().length, 0);
  });

  it("rejects oversized, malformed and invalid UTF-8 bodies before provisioning", async () => {
    assert.equal((await request(createBody({ name: "x".repeat(256001) }))).status, 413);
    assert.equal((await request("{")).status, 400);
    const invalid = await fetch(`${app.url}/api/portal`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: new Uint8Array([255]) });
    assert.equal(invalid.status, 400);
    assert.equal(adminCalls().length, 0);
  });

  it("rejects duplicate checkout lines and invalid quantities before the order RPC", async () => {
    const line = { product_id: productId, quantity: 1 };
    for (const items of [[line, line], [{ ...line, quantity: 0 }], [{ ...line, quantity: 10000 }]]) {
      assert.equal((await request({ operation: "placeOrder", items, request_id: randomUUID() }, customerCookie)).status, 400);
    }
    assert.equal(fixture.requests.filter(row => row.path.endsWith("/wholesale_place_order")).length, 0);
  });

  it("fails closed when protected role RPC is unavailable", async () => {
    fixture.roleError = { code: "PGRST202", message: "Fixture role function missing" };
    const response = await request(); assert.equal(response.status, 503);
    const body = await response.json(); assert.match(body.error, /portal.*setup|setup.*migration/i);
    assert.equal(adminCalls().length, 0);
  });

  it("does not expose public signup or email-confirmation routes", async () => {
    for (const path of ["/register", "/auth/confirm", "/auth/callback", "/api/register"]) assert.equal((await fetch(`${app.url}${path}`, { redirect: "manual" })).status, 404, path);
    const html = await (await fetch(`${app.url}/login`)).text();
    assert.match(html, /Access key or owner email/); assert.ok(!html.includes('href="/register"'));
    assert.ok(!html.includes(fixtureServiceKey));
  });

  it("signs in through the real access-key server action and sets the session cookie", async () => {
    const html = await (await fetch(`${app.url}/login`)).text();
    const actionName = html.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    assert.ok(actionName, "The server-rendered login must contain its form action");
    const form = new FormData(); form.set(actionName, ""); form.set("email", " SHOP-ONE "); form.set("password", fixturePassword);
    const response = await fetch(`${app.url}/login`, { method: "POST", headers: { Origin: app.url }, body: form, redirect: "manual" });
    assert.ok([303, 307].includes(response.status), `Sign-in should redirect, received ${response.status}`);
    assert.equal(new URL(response.headers.get("location"), app.url).pathname, "/");
    assert.match(response.headers.get("set-cookie") ?? "", /auth-token/);
    const tokenCall = fixture.requests.find(row => row.path === "/auth/v1/token");
    assert.equal(tokenCall.body.email, customer.email);
  });

  it("explains missing server-only provisioning configuration without granting access", async () => {
    const unconfigured = await startPortalApp(fixture, { SUPABASE_SERVICE_ROLE_KEY: "" });
    try {
      const response = await fetch(`${unconfigured.url}/api/portal`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify(createBody()) });
      assert.equal(response.status, 503); assert.match((await response.json()).error, /SUPABASE_SERVICE_ROLE_KEY/); assert.equal(adminCalls().length, 0);
    } finally { await unconfigured.close(); }
  });
});
