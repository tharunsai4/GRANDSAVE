import assert from "node:assert/strict";
import test from "node:test";
import { createPortalDatabase, ids } from "./portal-db-fixture.mjs";

test("wholesale Postgres migration enforces access, DB pricing and customer balances", async (t) => {
  const fixture = await createPortalDatabase();
  const { db } = fixture;
  let aliceOrder;
  let bobOrder;
  let draftOrder;
  const items = [{ product_id: ids.product, quantity: 2, unit_price: 0 }];
  const place = (lines = items, request = ids.request) => fixture.scalar(
    "select public.wholesale_place_order($1::jsonb,'Customer order',$2::uuid)", [JSON.stringify(lines), request],
  );
  try {
    await t.test("owner bootstrap rejects the placeholder and a missing or unconfirmed identity", async () => {
      for (const email of [null, "missing@example.test"]) {
        const script = email ? fixture.ownerSetup.replaceAll("YOUR_OWNER_EMAIL", email) : fixture.ownerSetup;
        await assert.rejects(db.exec(script), /Replace YOUR_OWNER_EMAIL|exactly one Auth user/);
        await db.exec("rollback");
      }
      await db.query("insert into auth.users (id,email) values ($1,'unconfirmed@example.test')", [ids.unconfirmed]);
      await assert.rejects(db.exec(fixture.ownerSetup.replaceAll("YOUR_OWNER_EMAIL", "unconfirmed@example.test")), /Confirm the owner Auth user/);
      await db.exec("rollback");
      await db.exec(fixture.ownerSetup.replaceAll("YOUR_OWNER_EMAIL", "owner@example.test"));
      await db.query("update auth.users set email_confirmed_at=now() where id=$1", [ids.unconfirmed]);
      await assert.rejects(db.exec(fixture.ownerSetup.replaceAll("YOUR_OWNER_EMAIL", "unconfirmed@example.test")), /different owner is already/);
      await db.exec("rollback");
      await fixture.user(ids.owner);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "owner");
    });

    await t.test("signup metadata cannot enable customer access or grant owner authority", async () => {
      await fixture.addUser(ids.alice, "alice-shop", { role: "owner", approved: true, access_enabled: true, access_key: "forged" });
      await fixture.addUser(ids.bob, "bob-shop");
      await fixture.addUser(ids.disabled, "disabled-shop", { role: "owner", access_enabled: true, access_key: "disabled-shop" });
      await fixture.user(ids.alice);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "pending");
      const profile = (await db.query("select access_key,access_enabled,approved,email from public.wholesale_customers")).rows;
      assert.deepEqual(profile, [{ access_key: null, access_enabled: false, approved: true, email: "alice-shop@shop.example" }]);
      await assert.rejects(db.query("update public.wholesale_customers set access_enabled=true,access_key='alice-shop' where id=$1", [ids.alice]), /permission denied/);
      await assert.rejects(db.query("insert into private.wholesale_owners values ($1)", [ids.alice]), /permission denied/);
      await assert.rejects(db.query("select public.wholesale_enable_customer($1,'alice-shop')", [ids.alice]), /Owner access required/);
      await fixture.enable(ids.alice, "ALICE-SHOP");
      await fixture.enable(ids.bob, "bob-shop");
      await assert.rejects(db.query("select public.wholesale_enable_customer($1,'owner-key')", [ids.owner]), /Protected owner/);
      await assert.rejects(db.query("select public.wholesale_enable_customer($1,'wrong-key')", [ids.disabled]), /does not match/);
      assert.equal(await fixture.scalar("select public.wholesale_can_manage_customer($1)", [ids.owner]), false);
      assert.equal(await fixture.scalar("select public.wholesale_can_manage_customer($1)", [ids.disabled]), false);
      assert.equal(await fixture.scalar("select public.wholesale_can_manage_customer($1)", [ids.alice]), true);
    });

    await t.test("owner manages catalogue; customers see only active products and live offers", async () => {
      await fixture.user(ids.owner);
      await db.query(`insert into public.wholesale_products (id,code,name,pack,price,active) values
        ($1,'P1','Product one','12 packs',20,true),($2,'OLD','Archived product','1 pack',1,false)`, [ids.product, ids.archived]);
      await db.query(`insert into public.wholesale_offers (product_id,price,starts_at,ends_at) values
        ($1,15,now()-interval '1 day',now()+interval '1 day'),
        ($1,12,now()-interval '1 day',now()+interval '1 day'),
        ($1,1,now()-interval '2 days',now()-interval '1 day'),
        ($1,2,now()+interval '1 day',now()+interval '2 days'),
        ($2,0.5,now()-interval '1 day',now()+interval '1 day')`, [ids.product, ids.archived]);
      await fixture.user(ids.alice);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "customer");
      assert.deepEqual((await db.query("select code from public.wholesale_products")).rows, [{ code: "P1" }]);
      assert.equal(Number(await fixture.scalar("select count(*) from public.wholesale_offers")), 2);
      assert.deepEqual((await db.query("update public.wholesale_products set price=0 where id=$1 returning id", [ids.product])).rows, []);
      await assert.rejects(db.query("insert into public.wholesale_products (code,name,price) values ('FORGED','Forged',0)"), /row-level security/);
      await assert.rejects(db.query("delete from public.wholesale_products where id=$1", [ids.product]), /permission denied/);
      await fixture.user(ids.disabled);
      assert.deepEqual((await db.query("select * from public.wholesale_products")).rows, []);
      assert.deepEqual((await db.query("select * from public.wholesale_offers")).rows, []);
      await assert.rejects(place(), /not enabled or approved/);
    });

    await t.test("checkout prices in the database, snapshots product details and deduplicates retries", async () => {
      await fixture.user(ids.alice);
      aliceOrder = await place();
      assert.equal(await place(), aliceOrder);
      const order = (await db.query("select customer_id,status,total from public.wholesale_orders where id=$1", [aliceOrder])).rows[0];
      assert.equal(order.customer_id, ids.alice);
      assert.equal(order.status, "Placed");
      assert.equal(Number(order.total), 24);
      assert.deepEqual((await db.query("select name,code,pack,quantity,unit_price from public.wholesale_order_items where order_id=$1", [aliceOrder])).rows, [
        { name: "Product one", code: "P1", pack: "12 packs", quantity: 2, unit_price: "12.00" },
      ]);
      await assert.rejects(db.query("update public.wholesale_orders set total=0 where id=$1", [aliceOrder]), /permission denied/);
      await assert.rejects(db.query("update public.wholesale_order_items set unit_price=0 where order_id=$1", [aliceOrder]), /permission denied/);
      await fixture.user(ids.owner);
      await db.query("update public.wholesale_products set name='New product name',price=99 where id=$1", [ids.product]);
      await db.query("update public.wholesale_offers set price=50 where product_id=$1", [ids.product]);
      assert.equal(Number(await fixture.scalar("select total from public.wholesale_orders where id=$1", [aliceOrder])), 24);
      assert.equal(await fixture.scalar("select name from public.wholesale_order_items where order_id=$1", [aliceOrder]), "Product one");
      await fixture.user(ids.alice);
      assert.equal(await place(), aliceOrder);
    });

    await t.test("malformed, duplicate and unavailable checkout items roll back without an orphan order", async () => {
      await fixture.user(ids.alice);
      const before = Number(await fixture.scalar("select count(*) from public.wholesale_orders"));
      for (const lines of [[], [{ product_id: ids.product, quantity: 0 }], [{ product_id: ids.product, quantity: 10000 }],
        [{ product_id: ids.product, quantity: 1.5 }], [{ product_id: ids.product, quantity: "2" }],
        [{ product_id: ids.product, quantity: 1 }, { product_id: ids.product, quantity: 1 }],
        [{ product_id: ids.archived, quantity: 1 }]]) {
        await assert.rejects(place(lines, null), /product|quantit|Combine/i);
      }
      assert.equal(Number(await fixture.scalar("select count(*) from public.wholesale_orders")), before);
      await assert.rejects(db.query("select private.wholesale_create_order($1,'[]','Placed','',current_date,null)", [ids.bob]), /permission denied/);
    });

    await t.test("cross-customer orders, items and payments remain isolated", async () => {
      await fixture.user(ids.bob);
      bobOrder = await place([{ product_id: ids.product, quantity: 1 }], null);
      assert.deepEqual((await db.query("select id from public.wholesale_orders")).rows, [{ id: bobOrder }]);
      assert.deepEqual((await db.query("select order_id from public.wholesale_order_items")).rows, [{ order_id: bobOrder }]);
      await assert.rejects(db.query("select public.wholesale_owner_order($1,$2::jsonb)", [ids.alice, JSON.stringify(items)]), /Owner access required/);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,1,'Cash',current_date)", [aliceOrder]), /Owner access required/);
      await assert.rejects(db.query("select public.wholesale_can_manage_customer($1)", [ids.alice]), /Owner access required/);
      await fixture.user(ids.disabled);
      assert.deepEqual((await db.query("select * from public.wholesale_orders")).rows, []);
      await fixture.user(ids.owner);
      assert.equal(Number(await fixture.scalar("select count(*) from public.wholesale_orders")), 2);
    });

    await t.test("owner payments cap the balance and prevent cancellation of paid orders", async () => {
      await fixture.user(ids.owner);
      await db.query("select public.wholesale_record_payment($1,10,'Bank transfer',current_date,'First payment')", [aliceOrder]);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,14.01,'Cash',current_date)", [aliceOrder]), /exceeds the outstanding/);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,1.001,'Cash',current_date)", [aliceOrder]), /Invalid payment/);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,'NaN','Cash',current_date)", [aliceOrder]), /Invalid payment/);
      await db.query("select public.wholesale_record_payment($1,14,'Cash',current_date)", [aliceOrder]);
      await assert.rejects(db.query("select public.wholesale_set_order_status($1,'Cancelled')", [aliceOrder]), /recorded payments/);
      await assert.rejects(db.query("select public.wholesale_set_order_status($1,'Draft')", [aliceOrder]), /recorded payments/);
      await db.query("select public.wholesale_set_order_status($1,'Completed')", [aliceOrder]);
      await fixture.user(ids.alice);
      assert.equal(Number(await fixture.scalar("select sum(amount) from public.wholesale_payments")), 24);
      const balance = await fixture.scalar(`select sum(o.total) - coalesce((select sum(p.amount) from public.wholesale_payments p),0)
        from public.wholesale_orders o where o.status not in ('Draft','Cancelled')`);
      assert.equal(Number(balance), 0);
      await fixture.user(ids.bob);
      assert.deepEqual((await db.query("select * from public.wholesale_payments")).rows, []);
      assert.equal(Number(await fixture.scalar("select total from public.wholesale_orders where id=$1", [bobOrder])), 50);
    });

    await t.test("owner-created orders use current pricing; drafts and cancellations cannot receive payments", async () => {
      await fixture.user(ids.owner);
      draftOrder = await fixture.scalar("select public.wholesale_owner_order($1,$2::jsonb,'Draft','Owner order',current_date)", [
        ids.alice, JSON.stringify([{ product_id: ids.product, quantity: 1, unit_price: 0 }]),
      ]);
      assert.equal(Number(await fixture.scalar("select total from public.wholesale_orders where id=$1", [draftOrder])), 50);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,1,'Cash',current_date)", [draftOrder]), /draft or cancelled/);
      await db.query("select public.wholesale_set_order_status($1,'Cancelled')", [draftOrder]);
      await assert.rejects(db.query("select public.wholesale_record_payment($1,1,'Cash',current_date)", [draftOrder]), /draft or cancelled/);
      await assert.rejects(db.query("select public.wholesale_owner_order($1,$2::jsonb)", [ids.owner, JSON.stringify(items)]), /valid customer/);
    });

    await t.test("safe profile updates preserve authority; owner-created access works immediately and can be paused", async () => {
      await fixture.user(ids.alice);
      await db.query("select public.wholesale_update_profile('Alice Jones','Alice Shop','0123456789','High Street')");
      assert.equal(await fixture.scalar("select business_name from public.wholesale_customers"), "Alice Shop");
      await assert.rejects(db.query("select public.wholesale_set_customer_approval($1,false)", [ids.bob]), /Owner access required/);
      await fixture.user(ids.owner);
      await db.query("select public.wholesale_set_customer_approval($1,false)", [ids.alice]);
      await fixture.user(ids.alice);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "pending");
      assert.deepEqual((await db.query("select * from public.wholesale_orders")).rows, []);
      await fixture.user(ids.owner);
      await db.query("select public.wholesale_set_customer_approval($1,true)", [ids.alice]);
      await db.query("update public.wholesale_settings set require_customer_approval=true where id=true");
      await fixture.addUser(ids.approval, "approval-shop", { approved: true });
      await fixture.enable(ids.approval, "approval-shop");
      await fixture.user(ids.approval);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "customer");
      await fixture.user(ids.owner);
      await db.query("select public.wholesale_set_customer_approval($1,false)", [ids.approval]);
      await fixture.user(ids.approval);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "pending");
      await fixture.user(ids.owner);
      await db.query("select public.wholesale_set_customer_approval($1,true)", [ids.approval]);
      await fixture.user(ids.approval);
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "customer");
    });

    await t.test("anonymous sessions cannot read tables or execute mutations", async () => {
      await fixture.admin();
      await db.exec("set role anon");
      assert.equal(await fixture.scalar("select public.wholesale_role()"), "anonymous");
      await assert.rejects(db.query("select * from public.wholesale_customers"), /permission denied/);
      await assert.rejects(db.query("select * from public.wholesale_products"), /permission denied/);
      await assert.rejects(place(), /permission denied/);
    });
    await t.test("all privileged RPCs have a fixed search path and no anonymous execution grant", async () => {
      await fixture.admin();
      const functions = (await db.query(`select p.proname,p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.proname like 'wholesale_%' and p.prosecdef`)).rows;
      assert.equal(functions.length, 11);
      for (const fn of functions) {
        assert.ok(fn.proconfig.some((setting) => setting === 'search_path=""'), fn.proname);
        assert.equal(fn.anon_execute, fn.proname === "wholesale_role", fn.proname);
      }
    });
  } finally {
    await db.close();
  }
});
