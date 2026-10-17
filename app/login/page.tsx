import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getPortalUser, PortalAccessError } from "../../lib/auth";
import { getMissingSupabaseVariables, getSupabaseConfig } from "../../lib/supabase/config";
import { signIn, signOut } from "../auth/actions";
import AuthShell from "./auth-shell";
import SubmitButton from "./submit-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | GrandSave", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  credentials: "The access key, email or password is incorrect. Please try again.",
  unavailable: "We couldn’t reach the sign-in service. Please try again in a moment.",
  signout: "We couldn’t sign you out. Please try again.",
  "rate-limit": "Too many sign-in attempts. Please wait a moment and try again.",
  "portal-setup": "The wholesale portal database needs to be set up. Ask the administrator to run the portal migration and owner setup SQL.",
  access: "Your account is not enabled for this portal. Please contact GrandSave.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const ready = Boolean(getSupabaseConfig());
  const missing = getMissingSupabaseVariables();
  const params = await searchParams;
  let errorCode = typeof params.error === "string" ? params.error : "";
  let user = null;
  try {
    user = await getPortalUser();
  } catch (error) {
    if (error instanceof PortalAccessError) errorCode = error.kind === "setup" ? "portal-setup" : "unavailable";
    else throw error;
  }
  if (user && errorCode !== "signout") redirect("/");

  return (
    <AuthShell>
      <span className="auth-card-icon"><LockKeyhole size={23} /></span>
      <span className="auth-eyebrow">WHOLESALE PORTAL</span>
      <h2>{user ? "Sign out of your account" : "Welcome back"}</h2>
      <p className="auth-intro">{user ? "End your session on this device." : "Use your customer access key or owner email to sign in."}</p>
      {!ready && <div className="auth-configuration" role="status"><strong>Sign-in setup is incomplete</strong><p>The administrator needs to configure {missing.map((name, index) => <span key={name}>{index > 0 ? " and " : ""}<code>{name}</code></span>)} and redeploy.</p><a href="/setup">View setup instructions</a></div>}
      {ready && errors[errorCode] && <p className="auth-error" role="alert">{errors[errorCode]}</p>}
      {user ? <form action={signOut}><SubmitButton label="Sign out" pendingLabel="Signing out…" /></form> : <form action={signIn} className="auth-form">
        <label htmlFor="email">Access key or owner email</label>
        <input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your access key or email" maxLength={254} required disabled={!ready} autoFocus={ready} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" maxLength={4096} required disabled={!ready} />
        <SubmitButton disabled={!ready} />
      </form>}
      <p className="auth-help">Need customer access or a new password? Ask GrandSave for your access key and password.</p>
    </AuthShell>
  );
}
