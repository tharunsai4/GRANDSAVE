import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { getMissingSupabaseVariables, getSupabaseConfig } from "../../lib/supabase/config";
import AuthShell from "../login/auth-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up | GrandSave", robots: { index: false, follow: false } };

export default function Setup() {
  if (getSupabaseConfig()) redirect("/login");
  const missing = getMissingSupabaseVariables();
  return (
    <AuthShell>
      <span className="auth-card-icon"><Settings2 size={23} /></span>
      <span className="auth-eyebrow">ONE-TIME SETUP</span>
      <h2>Connect your wholesale portal</h2>
      <p className="auth-intro">Connect sign-in and saved records, then create customer access from the owner account.</p>
      <div className="auth-configuration" role="status"><strong>Settings still needed</strong><ul>{missing.map((name) => <li key={name}><code>{name}</code></li>)}</ul></div>
      <ol className="auth-setup-list">
        <li><strong>Connect Supabase</strong><p>Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in Vercel. Add <code>SUPABASE_SERVICE_ROLE_KEY</code> as a server-only secret so the owner can create customer accounts. Never give this secret a public prefix.</p></li>
        <li><strong>Prepare the owner account</strong><p>Run the included portal migration and owner setup SQL for your existing Supabase owner account. This grants access to the owner’s management tools.</p></li>
        <li><strong>Create customer access</strong><p>Keep public sign-ups disabled. The owner creates a customer access key and password inside the portal and gives them to the customer. No customer email confirmation is needed.</p></li>
      </ol>
      <a href="/login" className="auth-submit">Go to sign in</a>
      <a href="/" className="auth-secondary-link">Check setup again</a>
      <p className="auth-help">After changing Vercel settings, redeploy before checking again.</p>
    </AuthShell>
  );
}
