// Local-only test doubles. No Supabase project or real account is contacted.
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
export const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
};
export const other = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "other@example.test",
};
const fakePublicKey = "sb_publishable_FAKE_LOCAL_TEST_KEY_NOT_A_REAL_CREDENTIAL";
export const fakePassword = "FAKE_LOCAL_FIXTURE_PASSWORD";

function reply(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text || "null");
}

function authUser(user) {
  return {
    ...user,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Local test owner" },
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function fakeAccessToken(user, url) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: user.id, email: user.email, role: "authenticated", aud: "authenticated",
      iat: now, exp: now + 3600, iss: `${url}/auth/v1`, session_id: randomUUID(),
    }),
  ].join(".");
  return `${unsigned}.${createHmac("sha256", "FAKE_LOCAL_TEST_SIGNING_KEY").update(unsigned).digest("base64url")}`;
}

export async function startSupabaseFixture() {
  const fixture = {
    rows: new Map(),
    tokens: new Map(),
    requests: [],
    databaseFault: null,
    url: "",
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, fixture.url);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const user = fixture.tokens.get(token);
      fixture.requests.push({ method: request.method, path: url.pathname, search: url.search, userId: user?.id });

      if (url.pathname === "/auth/v1/token" && request.method === "POST") {
        const body = await bodyOf(request);
        const account = [owner, other].find((candidate) => candidate.email === body.email);
        if (url.searchParams.get("grant_type") !== "password" || !account || body.password !== fakePassword) {
          return reply(response, 400, { code: "invalid_credentials", msg: "Invalid local fixture credentials" });
        }
        const accessToken = fakeAccessToken(account, fixture.url);
        fixture.tokens.set(accessToken, authUser(account));
        return reply(response, 200, {
          access_token: accessToken, token_type: "bearer", expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: `FAKE_LOCAL_REFRESH_${account.id}`, user: authUser(account),
        });
      }

      if (url.pathname === "/auth/v1/user" && request.method === "GET") {
        return user
          ? reply(response, 200, user)
          : reply(response, 401, { code: "bad_jwt", msg: "Unrecognized local fixture session" });
      }

      if (url.pathname === "/auth/v1/logout" && request.method === "POST") {
        return reply(response, 200, {});
      }

      if (url.pathname === "/rest/v1/desk_states") {
        if (!user) return reply(response, 401, { code: "PGRST301", message: "Session required" });
        if (fixture.databaseFault) return reply(response, 503, fixture.databaseFault);

        if (request.method === "GET") {
          assert.equal(url.searchParams.get("owner_id"), `eq.${user.id}`, "Reads must filter by the verified owner ID");
          const row = fixture.rows.get(user.id);
          return reply(response, 200, row ? [{ payload: row.payload, version: row.version }] : []);
        }

        if (request.method === "POST") {
          const row = await bodyOf(request);
          assert.equal(row.owner_id, user.id, "Inserts must use the verified owner ID");
          if (fixture.rows.has(user.id)) {
            return reply(response, 409, { code: "23505", message: "Duplicate owner ID" });
          }
          fixture.rows.set(user.id, structuredClone(row));
          return reply(response, 201, { version: row.version });
        }

        if (request.method === "PATCH") {
          assert.equal(url.searchParams.get("owner_id"), `eq.${user.id}`, "Updates must filter by verified owner ID");
          const values = await bodyOf(request);
          const row = fixture.rows.get(user.id);
          if (!row || url.searchParams.get("version") !== `eq.${row.version}`) {
            return reply(response, 200, []);
          }
          fixture.rows.set(user.id, { ...row, ...structuredClone(values) });
          return reply(response, 200, [{ version: values.version }]);
        }
      }

      reply(response, 404, { message: `Unexpected local fixture route: ${request.method} ${url.pathname}` });
    } catch (error) {
      reply(response, 500, { code: "FIXTURE_FAILURE", message: String(error) });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  fixture.url = `http://127.0.0.1:${server.address().port}`;

  fixture.cookieFor = async (account) => {
    const jar = new Map();
    const supabase = createServerClient(fixture.url, fakePublicKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: fakePassword });
    assert.ifError(error);
    assert.ok(jar.size > 0, "Supabase SSR must create a session cookie");
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  };
  fixture.close = async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return fixture;
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startProductionApp(fixture, overrides = {}) {
  try {
    await access(join(projectRoot, ".next", "BUILD_ID"));
  } catch {
    throw new Error("Build the application with npm run build before running the integration tests.");
  }
  const port = await unusedPort();
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: fixture.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fakePublicKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    OWNER_EMAIL: owner.email,
    NEXT_TELEMETRY_DISABLED: "1",
    ...overrides,
  };
  const child = spawn(process.execPath, [join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  const url = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
    deadline.unref();
    await exited;
    clearTimeout(deadline);
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Next.js stopped during startup:\n${output}`);
      try {
        const response = await fetch(`${url}/login`, { signal: AbortSignal.timeout(1000) });
        if (response.status < 500) return { url, close, output: () => output };
      } catch { /* The port is not ready yet. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Next.js did not start within 30 seconds:\n${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

export function exampleState(name = "Test product") {
  return {
    products: [{
      id: "test-product-1", code: "SKU-001", name, category: "Groceries", pack: "6 x 1 kg",
      units: 6, cost: 12.5, rrp: 3.25, image: "", active: true, createdAt: "2026-10-17T10:00:00.000Z",
    }],
    offers: [{ id: "test-offer-1", productId: "test-product-1", offerPrice: 10, startsAt: "2026-10-17", endsAt: "2026-10-18" }],
    orders: [{
      id: "test-order-1", reference: "GS-001", customer: "Test customer", date: "2026-10-17", status: "Confirmed",
      items: [{ productId: "test-product-1", name, code: "SKU-001", quantity: 2, unitPrice: 10 }],
      notes: "Deliver on Monday", createdAt: "2026-10-17T10:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z",
    }],
    payments: [{ id: "test-payment-1", orderId: "test-order-1", amount: 5, date: "2026-10-17", method: "Cash", note: "Deposit" }],
    settings: { businessName: "GrandSave", contactName: "Owner", email: owner.email, phone: "0123456789" },
  };
}
