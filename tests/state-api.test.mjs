import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { exampleState, other, owner, startProductionApp, startSupabaseFixture } from "./fixture.mjs";

describe("Production API with a local Supabase HTTP fixture", { timeout: 60000 }, () => {
  let fixture;
  let app;
  let ownerCookie;
  let otherCookie;

  before(async () => {
    fixture = await startSupabaseFixture();
    ownerCookie = await fixture.cookieFor(owner);
    otherCookie = await fixture.cookieFor(other);
    app = await startProductionApp(fixture);
  });

  after(async () => {
    if (app) await app.close();
    if (fixture) await fixture.close();
  });

  beforeEach(() => {
    fixture.rows.clear();
    fixture.requests.length = 0;
    fixture.databaseFault = null;
  });

  function request(options = {}) {
    const { cookie = ownerCookie, body, method = "GET", headers = {} } = options;
    return fetch(`${app.url}/api/state`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  }

  it("loads an empty desk, saves all record types, reloads, and updates the saved version", async () => {
    const initial = await request();
    assert.equal(initial.status, 200);
    assert.match(initial.headers.get("cache-control"), /private.*no-store/);
    assert.match(initial.headers.get("vary"), /cookie/i);
    assert.deepEqual(await initial.json(), {
      state: { products: [], offers: [], orders: [], payments: [], settings: { businessName: "GrandSave", contactName: "", email: "", phone: "" } },
      version: 0,
    });

    const state = exampleState();
    const firstSave = await request({ method: "PUT", body: { state, version: 0 }, headers: { Origin: app.url } });
    assert.equal(firstSave.status, 200);
    assert.deepEqual(await firstSave.json(), { version: 1 });
    assert.deepEqual(await (await request()).json(), { state, version: 1 });

    state.products[0].active = false;
    state.orders[0].status = "Completed";
    const secondSave = await request({ method: "PUT", body: { state, version: 1 } });
    assert.equal(secondSave.status, 200);
    assert.deepEqual(await secondSave.json(), { version: 2 });
    assert.deepEqual(await (await request()).json(), { state, version: 2 });
    assert.ok(fixture.requests.some((entry) => entry.path === "/auth/v1/user" && entry.userId === owner.id));
    assert.ok(fixture.requests.some((entry) => entry.method === "PATCH" && entry.search.includes("version=eq.1")));
  });

  it("rejects an unauthenticated request and ignores claimed user headers", async () => {
    const claimedIdentity = {
      "x-user-id": owner.id, "x-user-email": owner.email,
      "oai-authenticated-user-id": owner.id, "oai-authenticated-user-email": owner.email,
    };
    const response = await request({ cookie: "", headers: claimedIdentity });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /sign in/i);
    const save = await request({ cookie: "", method: "PUT", body: { state: exampleState(), version: 0 }, headers: claimedIdentity });
    assert.equal(save.status, 401);
    assert.equal(fixture.requests.filter((entry) => entry.path === "/rest/v1/desk_states").length, 0);
  });

  it("rejects a valid Supabase session belonging to another account", async () => {
    const read = await request({ cookie: otherCookie });
    assert.equal(read.status, 403);
    const save = await request({ cookie: otherCookie, method: "PUT", body: { state: exampleState(), version: 0 } });
    assert.equal(save.status, 403);
    assert.equal(fixture.rows.size, 0);
    assert.equal(fixture.requests.filter((entry) => entry.path === "/rest/v1/desk_states").length, 0);
  });

  it("rejects stale saves without overwriting the saved desk", async () => {
    const first = exampleState("Original");
    assert.equal((await request({ method: "PUT", body: { state: first, version: 0 } })).status, 200);
    const latest = exampleState("Latest");
    assert.equal((await request({ method: "PUT", body: { state: latest, version: 1 } })).status, 200);
    const stale = await request({ method: "PUT", body: { state: exampleState("Stale tab"), version: 1 } });
    assert.equal(stale.status, 409);
    assert.deepEqual(await (await request()).json(), { state: latest, version: 2 });
  });

  it("allows exactly one concurrent first save", async () => {
    const states = [exampleState("First tab"), exampleState("Second tab")];
    const responses = await Promise.all(states.map((state) => request({ method: "PUT", body: { state, version: 0 } })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = responses.findIndex((response) => response.status === 200);
    assert.deepEqual(await (await request()).json(), { state: states[winner], version: 1 });
  });

  it("allows exactly one concurrent update from the same version", async () => {
    assert.equal((await request({ method: "PUT", body: { state: exampleState(), version: 0 } })).status, 200);
    const states = [exampleState("First update"), exampleState("Second update")];
    const responses = await Promise.all(states.map((state) => request({ method: "PUT", body: { state, version: 1 } })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = responses.findIndex((response) => response.status === 200);
    assert.deepEqual(await (await request()).json(), { state: states[winner], version: 2 });
  });

  it("rejects malformed JSON, invalid records, and invalid versions", async () => {
    const invalidBodies = [
      "{broken-json", "null", "[]", { state: {}, version: 0 },
      { state: exampleState(), version: -1 }, { state: exampleState(), version: 0.5 },
      { state: exampleState(), version: 2147483647 },
      { state: { ...exampleState(), products: [{ ...exampleState().products[0], units: 0 }] }, version: 0 },
      { state: { ...exampleState(), orders: [{ ...exampleState().orders[0], status: "Unknown" }] }, version: 0 },
      { state: { ...exampleState(), payments: [{ ...exampleState().payments[0], amount: -10 }] }, version: 0 },
    ];
    for (const body of invalidBodies) {
      const response = await request({ method: "PUT", body });
      assert.equal(response.status, 400, `Expected validation failure for ${JSON.stringify(body).slice(0, 180)}`);
    }
    assert.equal(fixture.rows.size, 0);
  });

  it("rejects cross-origin writes before reaching persistence", async () => {
    const response = await request({ method: "PUT", body: { state: exampleState(), version: 0 }, headers: { Origin: "https://unrelated.example.test" } });
    assert.equal(response.status, 403);
    assert.equal(fixture.rows.size, 0);
  });

  it("rejects malformed and mismatched-protocol origins", async () => {
    for (const origin of ["null", app.url.replace("http:", "https:"), `${app.url}/unexpected-path`]) {
      const response = await request({ method: "PUT", body: { state: exampleState(), version: 0 }, headers: { Origin: origin } });
      assert.equal(response.status, 403);
    }
    assert.equal(fixture.rows.size, 0);
  });

  it("fails closed with setup guidance when Supabase configuration is missing", async () => {
    const unconfigured = await startProductionApp(fixture, { NEXT_PUBLIC_SUPABASE_URL: "" });
    try {
      const home = await fetch(unconfigured.url, { redirect: "manual" });
      assert.equal(home.status, 307);
      assert.equal(new URL(home.headers.get("location"), unconfigured.url).pathname, "/setup");
      const response = await fetch(`${unconfigured.url}/api/state`, { headers: { Cookie: ownerCookie } });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /not configured/i);
    } finally {
      await unconfigured.close();
    }
  });

  it("requires JSON content type", async () => {
    const response = await request({ method: "PUT", body: "{}", headers: { "Content-Type": "text/plain" } });
    assert.equal(response.status, 415);
  });

  it("rejects workspaces larger than the one-megabyte byte limit", async () => {
    const state = exampleState();
    state.settings.businessName = "£".repeat(510000);
    const response = await request({ method: "PUT", body: { state, version: 0 } });
    assert.equal(response.status, 413);
    assert.equal(fixture.rows.size, 0);
  });

  it("reports an unavailable database and preserves existing state", async () => {
    const state = exampleState("Preserved");
    assert.equal((await request({ method: "PUT", body: { state, version: 0 } })).status, 200);
    fixture.databaseFault = { code: "42P01", message: "Missing test table" };
    assert.equal((await request()).status, 503);
    assert.equal((await request({ method: "PUT", body: { state: exampleState("Replacement"), version: 1 } })).status, 503);
    fixture.databaseFault = null;
    assert.deepEqual(await (await request()).json(), { state, version: 1 });
  });

  it("fails safely when stored data cannot be read", async () => {
    fixture.rows.set(owner.id, { owner_id: owner.id, payload: { damaged: true }, version: 3 });
    const response = await request();
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /could not be read/i);
    assert.deepEqual(fixture.rows.get(owner.id).payload, { damaged: true });
  });

  it("keeps the desk behind sign-in and renders the owner's desk with a verified session", async () => {
    const anonymous = await fetch(app.url, { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(new URL(anonymous.headers.get("location"), app.url).pathname, "/login");
    const signedIn = await fetch(app.url, { headers: { Cookie: ownerCookie } });
    assert.equal(signedIn.status, 200);
    assert.match(await signedIn.text(), /GrandSave/);
  });
});
