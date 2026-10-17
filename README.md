# GrandSave Order Desk for Vercel

A private wholesale order desk with products, timed offers, orders, payments, balances, business settings and backup import/export.

This edition uses standard Next.js, Supabase Authentication and Supabase Postgres. Start with **DEPLOY-TO-VERCEL.md**. It is a separate version of your app; the existing published Site continues to use its original database.

## Quick local start

Use Node.js 24. Create a Supabase project, run `supabase/migrations/0001_desk_states.sql`, and create the owner account as explained in the deployment guide.

```sh
npm ci
cp .env.example .env.local
# Fill the three values in .env.local, then:
npm run dev
```

Open the address printed by Next.js (normally http://localhost:3000), and sign in with the owner account you created in Supabase.

```sh
npm run build
npm start
```

## Required configuration

| Variable | Where to obtain the value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project Connect panel: Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same panel: publishable key; legacy anon key is also accepted |
| `OWNER_EMAIL` | Exact email of the Supabase user permitted to use this desk |

No service-role key is used. `OWNER_EMAIL` stays on the server. Login requires both a valid Supabase session and the configured owner email. Database row-level policies restrict access to the authenticated user's own record. Keep public signups disabled in this private project.

## Moving existing records

In the old desk, select Settings → Download backup. In this version, select Settings → Import backup. Review the record counts and choose Replace records. The import replaces this version's current records and settings; download a backup first if needed. Backup files are validated before saving. Importing data does not transfer login credentials or the old database account ID.

## Project layout

- `app/desk.tsx`: main interface and backup import/export.
- `app/login/`, `app/auth/actions.ts`: private email/password login and sign-out.
- `lib/auth.ts`, `lib/supabase/`, `proxy.ts`: verified sessions and cookie refresh.
- `app/api/state/route.ts`: load/save API with validation and atomic version checks.
- `lib/desk-types.ts`, `lib/desk-state-validation.ts`: record types and checks.
- `supabase/migrations/0001_desk_states.sql`: database table, grants and row policies.
- `vercel.json`, `package.json`: Vercel and Next.js build setup.

## Checks

`npm run typecheck` checks TypeScript. `npm run build` creates a standard Next.js production build. `npm test` runs the included tests; integration tests require a prior production build and use a local simulated Supabase service rather than a real account.

The application code and SQL are supplied. Provisioning your Supabase project, running its SQL, creating your login user and configuring the Vercel project are required before real records can be saved.
