import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  alice: "20000000-0000-4000-8000-000000000002",
  bob: "30000000-0000-4000-8000-000000000003",
  disabled: "40000000-0000-4000-8000-000000000004",
  unconfirmed: "50000000-0000-4000-8000-000000000005",
  approval: "60000000-0000-4000-8000-000000000006",
  product: "70000000-0000-4000-8000-000000000007",
  archived: "80000000-0000-4000-8000-000000000008",
  request: "90000000-0000-4000-8000-000000000009",
};

export async function createPortalDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      raw_user_meta_data jsonb not null default '{}'
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
  `);
  await db.query("insert into auth.users (id,email,email_confirmed_at) values ($1,'owner@example.test',now())", [ids.owner]);
  for (const file of ["0001_desk_states.sql", "0002_wholesale_portal.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  const ownerSetup = await readFile(new URL("../supabase/OWNER-SETUP.sql", import.meta.url), "utf8");
  return {
    db,
    ownerSetup,
    async admin() {
      await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
    },
    async user(id) {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    },
    async addUser(id, key, metadata = {}, confirmed = true) {
      await this.admin();
      await db.query("insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data) values ($1,$2,$3,$4)", [
        id, `${key}@customers.grandsave.invalid`, confirmed ? new Date().toISOString() : null,
        { name: key, contact_email: `${key}@shop.example`, ...metadata },
      ]);
    },
    async enable(id, key) {
      await this.user(ids.owner);
      await db.query("select public.wholesale_enable_customer($1,$2)", [id, key]);
    },
    async scalar(sql, parameters = []) {
      const result = await db.query(sql, parameters);
      return Object.values(result.rows[0])[0];
    },
  };
}
