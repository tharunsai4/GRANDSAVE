# Deploy GrandSave Order Desk to Vercel

You need a GitHub account, a Vercel account and a Supabase account. This package is the Vercel edition: use this ZIP rather than the earlier Sites source ZIP.

## 1. Set up Supabase

1. Open https://supabase.com/dashboard and create a project. Keep its database password in your own password manager.
2. In the project, open **SQL Editor → New query**.
3. Open `supabase/migrations/0001_desk_states.sql` from this package, copy its complete contents into SQL Editor and run it once. This creates the desk table and private access rules. If you already ran this migration successfully, do not rerun it.
4. Open **Authentication → Providers / Sign In → Email**, and keep email/password sign-in enabled. In the authentication signup settings, turn off **Allow new users to sign up** for this private desk.
5. Open **Authentication → Users → Add user / Create new user**. Create your own email/password user and mark its email as confirmed (Auto Confirm User). Choose the password yourself. There is no public signup form in this app.
6. Open the project **Connect** panel (or Settings → API / API Keys). Copy the **Project URL** and **publishable key**. A legacy anon key works too. Do not use a service-role/secret key.

Your app password is the password of the user created in Authentication → Users. It is separate from the Supabase database password and from your Vercel/Supabase account passwords. Store that password securely. This edition includes sign-in and sign-out; it does not include a public signup or email-based password recovery flow.

## 2. Upload the code to GitHub

1. Extract `GrandSave-Order-Desk-Vercel.zip`.
2. Create a **private** GitHub repository.
3. Upload everything inside the extracted `grandsave-order-desk-vercel` folder. `package.json` must be at the repository root. Include `app`, `lib`, `supabase`, `public`, the lockfile and configuration files.
4. Include `.env.example` as a template. Keep any actual `.env.local` file out of GitHub.

## 3. Create the Vercel project

1. Open https://vercel.com/new and import that GitHub repository.
2. Set **Framework Preset** to **Next.js**. Keep **Root Directory** at the repository root (`./`).
3. Use **Node.js 24.x**. The package declares this version already.
4. Use the supplied settings: **Install Command** `npm ci`, **Build Command** `npm run build`. Leave **Output Directory** at the Next.js default.
5. Under **Environment Variables**, add the following for Production and any Preview environment you intend to use:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL, such as `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |
| `OWNER_EMAIL` | The exact email of the user you created in step 1 |

6. Click **Deploy**. When it succeeds, open the assigned `.vercel.app` address.
7. Sign in with the email and password of your Supabase owner user.
8. In Supabase **Authentication → URL Configuration**, set the **Site URL** to your new Vercel HTTPS address, especially before using future email invitation or password-recovery links. This version uses password sign-in and does not require an OAuth callback route.

If you change environment variables after deployment, redeploy so the app gets the new values. Vercel is your web host; Supabase is where the login accounts and saved records live.

## 4. Confirm your desk works

1. Add a product and reload the page. The product should remain.
2. Create a confirmed order and record a payment. Check that Balances updates.
3. Use Settings → Download backup to keep a copy.
4. Sign out, and confirm that opening the home page requires sign-in again.

## 5. Transfer records from your current site

1. Sign in at https://grandsave-private-order-desk.zanywhale65.chatgpt.site and open Settings → Download backup.
2. Sign in to the Vercel edition. Download a backup there first if it already has records you want to keep.
3. Open Settings → Import backup and choose the old JSON file.
4. Review the counts and click **Replace records**. Wait for **All changes saved**, then reload and check the transferred records.

Data is transferred only when you import it. The source ZIP contains no live customer/product records or login credentials. The existing site stays available independently.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Setup page instead of login | Add all three variables above and redeploy. |
| Email or password incorrect | Use the manually created Supabase Auth user, a confirmed email and matching `OWNER_EMAIL`; the app does not use your previous ChatGPT login. |
| Could not load/save your desk | Run the supplied SQL once in the same Supabase project used by the environment variables. Check the project's availability. |
| Wrong account / access denied | Check `OWNER_EMAIL` and the owner user's confirmed email. Keep the supplied row policies enabled. |
| Conflict after another tab changed data | Reload to get the latest saved version before editing again. |
| Build cannot find package.json | Use the folder containing `package.json` as the GitHub/Vercel root. |
| Backup rejected | Choose a GrandSave JSON backup under 5 MB whose compact records fit the 1 MB save limit; a spreadsheet or source-code ZIP is not a record backup. |

## Official references

- Vercel deployment: https://vercel.com/docs/getting-started-with-vercel
- Vercel Next.js: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Supabase Next.js: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Supabase server sessions: https://supabase.com/docs/guides/auth/server-side/nextjs
