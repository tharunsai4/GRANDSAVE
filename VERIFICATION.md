# Verification — 17 October 2026

- Standard Next.js 16.4.2 production build passed on Node.js 24.
- TypeScript passed as part of the production build.
- All 28 included tests passed.
- Database migration and per-user access policies ran against embedded PostgreSQL (PGlite), including blocked cross-user access and anonymous access.
- API integration tests ran the actual production Next.js server with a local simulated Supabase Auth/PostgREST service. They cover authenticated save/reload, invalid sessions, forged identity headers, wrong-account access, conflicting saves, malformed input, body limits, unavailable database, configuration failures and origin checks.
- Browser checks with a disposable local test account passed: sign in, import a backup, save, reload the imported records and sign out.

The package has not been connected to your own Supabase project or deployed to your Vercel account. Follow DEPLOY-TO-VERCEL.md to provision the database, create the owner login and set the three environment variables. No real credentials or live business records are included in this archive.
