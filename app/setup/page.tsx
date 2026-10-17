import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { getOwnerEmail, getSupabaseConfig } from "../../lib/supabase/config";
import AuthShell from "../login/auth-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up | GrandSave", robots: { index: false, follow: false } };

export default function Setup() {
  if (getSupabaseConfig() && getOwnerEmail()) redirect("/");

  return (
    <AuthShell>
      <span className="auth-card-icon"><Settings2 size={23} /></span>
      <span className="auth-eyebrow">ONE-TIME SETUP</span>
      <h2>Connect your desk</h2>
      <p className="auth-intro">The application is ready. Add your business’s sign-in and database settings to start using it.</p>
      <ol className="auth-setup-list">
        <li><strong>Add the environment variables</strong><p>Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> and <code>OWNER_EMAIL</code> in Vercel. For local development, put them in <code>.env.local</code>.</p></li>
        <li><strong>Create the owner account</strong><p>In Supabase Authentication, create a confirmed user with the same email as <code>OWNER_EMAIL</code> and a password. Turn off public sign-ups.</p></li>
        <li><strong>Prepare the database</strong><p>Run the included database setup SQL from the project’s setup guide, then redeploy the application or restart your local server.</p></li>
      </ol>
      <a href="/" className="auth-submit">Check setup</a>
      <p className="auth-help">See the included setup guide for the complete steps.</p>
    </AuthShell>
  );
}
