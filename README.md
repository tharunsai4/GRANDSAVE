# GrandSave Wholesale for Vercel

A wholesale portal with separate owner and customer access, built with Next.js and Supabase. Start with **DEPLOY-TO-VERCEL.md**.

The owner creates a customer access key and password from Customers. Customers sign in immediately; no public registration or email confirmation is needed. Customers can browse products and live offers, place orders, view their own dashboard, orders, payments and balance, and edit their account details. The owner manages products, offers, customer access, orders and payments.

## Local start

Use Node.js 24. Run both migrations and the owner setup script in your Supabase project as described in the deployment guide. Copy `.env.example` to `.env.local`, supply the three values, then:

```sh
npm ci
npm run dev
```

Open the local address shown by Next.js. The owner signs in with their existing Supabase Auth email and password. Customers use their owner-issued access key and password.

```sh
npm run typecheck
npm run build
npm test
npm start
```

Tests run against local simulated services and an embedded PostgreSQL engine. They do not create production users or orders. Build before running the HTTP integration tests.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key; legacy anon key is also accepted |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only account creation and password resets, after owner authorization |

Never expose the service-role key to browser code or commit it. `OWNER_EMAIL` is no longer required. Owner permission comes from a protected database record created by `supabase/OWNER-SETUP.sql`; a user cannot select or edit their own role. Keep Supabase public signup disabled.

Customer passwords are handled by Supabase Auth, not stored in the application tables or returned by the API. Customer access keys are case insensitive. Optional contact email is separate from the login key. Owners can replace a customer's password; the current password cannot be retrieved.

## Existing records

Migration 0002 preserves the previous `desk_states` records. The owner can open **Settings → Previous private desk** at `/legacy` to view those records and download or import the original JSON backups. They are not automatically converted into the new customer portal: each order must be associated with a customer account before it can be shared. New portal records are stored in the `wholesale_*` tables and remain in Supabase.

## Project layout

- `app/portal.tsx`, `app/portal.css`: owner and customer interface.
- `app/api/portal/route.ts`: verified role checks, data loading, orders and owner actions.
- `app/auth/actions.ts`, `lib/auth.ts`, `lib/access-key.ts`: sign-in, sign-out and protected roles.
- `lib/supabase/admin.ts`: server-only customer account management.
- `supabase/migrations/0002_wholesale_portal.sql`: customer isolation, catalogue, orders, payments and checked database functions.
- `supabase/OWNER-SETUP.sql`: grants the existing owner account access.
- `app/legacy/`, `app/desk.tsx`, `app/api/state/`: preserved previous private desk.

Order prices and customer identity are determined in the database. Checkout retries use a request ID to avoid duplicate orders. Payments cannot exceed an order's outstanding balance. Paid orders cannot be changed to Draft or Cancelled.
