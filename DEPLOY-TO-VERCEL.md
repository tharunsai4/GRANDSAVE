# GrandSave Wholesale: deploy and upgrade

Updated 18 October 2026. This edition uses owner-issued customer access keys and passwords. No customer email confirmation is required.

## 1. Prepare the database

Use the same Supabase project already connected to GrandSave.

1. In SQL Editor, run `supabase/migrations/0001_desk_states.sql` only if you have never run it before.
2. Run the complete `supabase/migrations/0002_wholesale_portal.sql` once. This adds the wholesale portal and preserves the previous private desk records. Do not rerun an already successful migration.
3. Ensure your owner email/password user exists under Authentication → Users. If creating it, choose your own password and mark the owner email confirmed. This initial owner account is separate from customer accounts.
4. Open `supabase/OWNER-SETUP.sql`, replace `YOUR_OWNER_EMAIL` with your existing owner's exact Auth email, and run it. It checks that the user exists and is confirmed, then grants owner access. It refuses to silently replace a different owner.
5. Keep email/password sign-in enabled and **Allow new users to sign up** disabled. Customers are created by the authenticated owner inside GrandSave.

Customer accounts created from GrandSave are automatically confirmed by the server, so customers do not need email messages or confirmation links. A customer cannot grant themselves owner access by changing their profile or sign-in data.

## 2. Set Vercel environment values

Under your GrandSave project → Settings → Environment Variables, configure:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, or the existing legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key, kept on the server |

If the Supabase integration already supplies these values, reuse them. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported as a fallback for the public key. Do not add `NEXT_PUBLIC_` to the service-role key. Never put real keys in GitHub or chat. `OWNER_EMAIL` is no longer needed for authorization.

Apply settings to Production and any Preview environment you use. Changing environment values requires a new deployment. Vercel hosts the website; Supabase stores its accounts and business records.

## 3. Publish the code

Extract the supplied code ZIP and update your existing repository with its contents. The directory containing `package.json` must be the Vercel root. Keep `.env.local`, `node_modules` and `.next` out of Git.

For the existing repository, after copying the code into your checkout:

```sh
git status
git add .
git commit -m "Add owner-managed customer access and wholesale portal"
git push origin main
```

If your origin still uses the other GitHub account, set it to your repository before pushing:

```sh
git remote set-url origin https://github.com/tharunsai4/GRANDSAVE.git
```

For a new Vercel project, import the repository, choose Next.js, Node.js 24.x, install command `npm ci`, build command `npm run build`, and keep the default output directory. Existing connected projects deploy automatically after the push. Wait for the Vercel deployment to show Ready before opening the production site.

## 4. Give a customer access

1. Sign in as the owner with your Supabase Auth email and password.
2. Open **Customers → Create customer access**.
3. Enter the customer's name/business, a unique access key (4–40 letters, numbers, hyphens or underscores, starting with a letter or number), and a password of at least 10 characters. Contact email is optional.
4. Save. Give the website address, access key and password to that customer yourself.
5. The customer signs in immediately using their access key and password.

The password is shown only while you create or replace it. It cannot be retrieved later. Use **Reset password** on the customer's record to assign a replacement. Owner passwords cannot be changed from customer management.

Customers see their own orders, payments and balance. They can browse active products and current offers, place orders, and edit their account information. Product, offer, order status, payment and customer access controls are reserved for the owner.

## 5. Check the upgrade

1. Create a product and a customer account.
2. In a separate browser session, sign in with the customer's access key. Place an order and verify it appears in My orders.
3. As owner, find that order and record a partial payment. Confirm the remaining balance in both accounts.
4. Verify that a second customer cannot see the first customer's orders or payments.
5. Sign out and verify that the portal asks for credentials again.

For previous records, open **Settings → Previous private desk**. Those records remain private to the owner, with the original backup import/export. They are preserved separately until you explicitly associate historical orders with new customer accounts. New portal data is stored in Supabase's `wholesale_*` tables; use Supabase's database backup/export tools for those records.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Setup page | Check the public Supabase URL/key and redeploy. |
| Wholesale database needs setup | Run migration 0002 and OWNER-SETUP in the same Supabase project. |
| Owner appears as inactive customer | Run OWNER-SETUP using that account's exact Auth email. |
| Customer access setup incomplete | Add the server-only service-role key in Vercel, then redeploy. |
| Access key or password incorrect | Check the issued key/password. The owner can assign a replacement password. |
| Access key already in use | Choose another key or reset the existing account's password. |
| Customer access inactive | Ask the owner to restore that customer's access. |
| Old records absent from new dashboard | Open the previous private desk in Settings; the migration preserves them separately. |

## Official documentation

- [Supabase admin account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase authentication configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Next.js deployment](https://vercel.com/docs/frameworks/full-stack/nextjs)
