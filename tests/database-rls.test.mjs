import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Postgres migration enforces per-user access and table constraints", async (t) => {
  const db = new PGlite();
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  try {
    // Only the Supabase-managed auth objects are represented here. The real
    // application table, grants and policies come directly from the migration.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated, anon;
      insert into auth.users values ('${first}'), ('${second}');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/0001_desk_states.sql", import.meta.url), "utf8"));
    await db.exec(`insert into public.desk_states (owner_id,payload,version) values ('${second}','{"settings":{}}',1)`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${first}',false)`);

    await t.test("cannot see another user's desk", async () => {
      assert.deepEqual((await db.query("select * from public.desk_states")).rows, []);
    });
    await t.test("can create and update own desk", async () => {
      await db.query("insert into public.desk_states (owner_id,payload,version) values ($1,$2,1)", [first, { settings: { businessName: "GrandSave" } }]);
      const updated = await db.query("update public.desk_states set version=2 where owner_id=$1 and version=1 returning version", [first]);
      assert.deepEqual(updated.rows, [{ version: 2 }]);
    });
    await t.test("cannot overwrite or claim another user's desk", async () => {
      assert.deepEqual((await db.query("update public.desk_states set version=5 where owner_id=$1 returning owner_id", [second])).rows, []);
      await assert.rejects(db.query("update public.desk_states set owner_id=$1 where owner_id=$2", [second, first]), /row-level security/);
    });
    await t.test("cannot insert records for another account", async () => {
      // Check the policy before the duplicate primary key check can mask it.
      await assert.rejects(db.query("insert into public.desk_states (owner_id,payload,version) values ($1,'{}',1)", [second]), /row-level security/);
    });
    await t.test("rejects invalid payloads and nonpositive versions", async () => {
      await assert.rejects(db.query("update public.desk_states set version=0 where owner_id=$1", [first]), /check constraint/);
      await assert.rejects(db.query("update public.desk_states set payload='[]' where owner_id=$1", [first]), /check constraint/);
    });
    await t.test("does not grant deletion to the application", async () => {
      await assert.rejects(db.query("delete from public.desk_states where owner_id=$1", [first]), /permission denied/);
    });
    await t.test("anonymous sessions cannot read the table", async () => {
      await db.exec("reset role; set role anon");
      await assert.rejects(db.query("select * from public.desk_states"), /permission denied/);
    });
  } finally {
    await db.close();
  }
});
