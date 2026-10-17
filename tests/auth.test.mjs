import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Stub framework boundaries, not the authentication decisions under test.
function load(path, dependencies = {}, env = {}) {
  const compiled = ts.transpileModule(readFileSync(join(root, path), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports,process,URL){${compiled}\n})`, {})(name => {
    if (name === "server-only") return {};
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, { env }, URL);
  return module.exports;
}
const keys = load("lib/access-key.ts");
const redirect = destination => { throw { destination }; };
const config = { getSupabaseConfig: () => ({ url: "https://fixture.example.test", key: "FAKE_PUBLIC_KEY" }) };
function authModule({ role = "customer", roleError = null, user = { id: "verified-id", email: "shop-one@customers.grandsave.invalid", user_metadata: { role: "owner", approved: true } }, authError = null } = {}) {
  const calls = [];
  const auth = load("lib/auth.ts", {
    "next/navigation": { redirect }, "./supabase/config": config,
    "./supabase/server": { createClient: async () => ({
      auth: { getUser: async () => { calls.push("getUser"); return { data: { user }, error: authError }; } },
      rpc: async name => { calls.push(name); return { data: role, error: roleError }; },
    }) },
  });
  return { auth, calls };
}

 describe("access-key normalization and protected portal roles", () => {
  it("canonicalizes valid access keys and maps them to the reserved Auth email", () => {
    assert.equal(keys.normalizeAccessKey(" SHOP_123 "), "shop_123");
    assert.equal(keys.normalizeAccessKey("a".repeat(40)), "a".repeat(40));
    assert.equal(keys.accessKeyEmail(" SHOP-123 "), "shop-123@customers.grandsave.invalid");
  });
  it("rejects email addresses, paths, whitespace, invalid leading characters and out-of-range lengths", () => {
    for (const value of ["a", "abc", "-shop", "shop@bad.test", "shop name", "x".repeat(41), "../shop", "shop\nname"]) assert.equal(keys.normalizeAccessKey(value), null, value);
    assert.throws(() => keys.accessKeyEmail("bad@key"));
  });
  it("verifies Auth before using the protected role and ignores privileged user metadata", async () => {
    const { auth, calls } = authModule();
    const user = await auth.getPortalUser();
    assert.deepEqual(calls, ["getUser", "wholesale_role"]);
    assert.equal(user.role, "customer"); assert.equal(user.displayName, "Customer");
    assert.equal((await authModule({ role: "pending" }).auth.getPortalUser()).role, "pending");
    assert.equal(await authModule({ role: "unknown" }).auth.getPortalUser(), null);
  });
  it("retains owner-only legacy compatibility without relying on OWNER_EMAIL", async () => {
    assert.equal(await authModule().auth.getDeskUser(), null);
    assert.equal((await authModule({ role: "owner" }).auth.getDeskUser()).id, "verified-id");
  });
  it("fails closed with a safe 503 when role setup is missing", async () => {
    const { auth } = authModule({ roleError: { code: "PGRST202", message: "internal database details" } });
    await assert.rejects(auth.getPortalUser(), error => error instanceof auth.PortalAccessError && error.status === 503 && error.kind === "setup" && !error.message.includes("internal database details"));
  });
  it("does not call role RPC for an invalid session and reports Auth outages safely", async () => {
    const invalid = authModule({ authError: { status: 401 } });
    assert.equal(await invalid.auth.getPortalUser(), null); assert.deepEqual(invalid.calls, ["getUser"]);
    const unavailable = authModule({ authError: { status: 503 } });
    await assert.rejects(unavailable.auth.getPortalUser(), error => error.status === 503 && error.kind === "service");
  });
});

describe("sign-in actions", () => {
  function actions() {
    let credentials;
    const { auth } = authModule();
    const module = load("app/auth/actions.ts", {
      "next/cache": { revalidatePath: () => {} }, "next/navigation": { redirect },
      "../../lib/access-key": keys,
      "../../lib/auth": { PortalAccessError: auth.PortalAccessError, getPortalUser: async () => ({ id: "customer", role: "customer" }) },
      "../../lib/supabase/config": config,
      "../../lib/supabase/server": { createClient: async () => ({ auth: {
        signInWithPassword: async values => { credentials = values; return { data: { user: { id: "customer" } }, error: null }; },
        signOut: async () => ({ error: null }),
      } }) },
    });
    return { module, credentials: () => credentials };
  }
  it("maps customer access keys while preserving password whitespace", async () => {
    const { module, credentials } = actions();
    const form = new FormData(); form.set("email", " SHOP123 "); form.set("password", " unchanged password ");
    await assert.rejects(module.signIn(form), error => error.destination === "/");
    assert.equal(credentials().email, "shop123@customers.grandsave.invalid"); assert.equal(credentials().password, " unchanged password ");
  });
  it("accepts owner email and keeps public signup actions absent", async () => {
    const { module, credentials } = actions();
    const form = new FormData(); form.set("email", "Owner@Example.com"); form.set("password", "FAKE_PASSWORD");
    await assert.rejects(module.signIn(form), error => error.destination === "/");
    assert.equal(credentials().email, "owner@example.com");
    assert.equal(typeof module.signUp, "undefined"); assert.equal(typeof module.resendConfirmation, "undefined");
    await assert.rejects(module.signOut(), error => error.destination === "/login");
  });
  it("rejects internal synthetic addresses and malformed keys without contacting Auth", async () => {
    const { module, credentials } = actions();
    for (const value of ["shop123@customers.grandsave.invalid", "bad key", "abc"]) {
      const form = new FormData(); form.set("email", value); form.set("password", "FAKE_PASSWORD");
      await assert.rejects(module.signIn(form), error => error.destination === "/login?error=credentials");
    }
    assert.equal(credentials(), undefined);
  });
});

describe("setup config", () => {
  it("shows missing names without leaking configuration values and accepts the legacy public key", () => {
    const missing = load("lib/supabase/config.ts");
    assert.deepEqual([...missing.getMissingSupabaseVariables()], ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    const ready = load("lib/supabase/config.ts", {}, { NEXT_PUBLIC_SUPABASE_URL: " https://fixture.example.test ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " ", NEXT_PUBLIC_SUPABASE_ANON_KEY: "FAKE_LEGACY_KEY", OWNER_EMAIL: " Owner@Example.com " });
    assert.equal(ready.getSupabaseConfig().key, "FAKE_LEGACY_KEY"); assert.equal(ready.getOwnerEmail(), "owner@example.com");
    assert.deepEqual([...ready.getMissingSupabaseVariables()], []);
  });
});
