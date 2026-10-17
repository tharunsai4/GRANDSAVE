import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getDeskUser } from "../../lib/auth";
import { getOwnerEmail, getSupabaseConfig } from "../../lib/supabase/config";
import { signIn, signOut } from "../auth/actions";
import AuthShell from "./auth-shell";
import SubmitButton from "./submit-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | GrandSave", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  credentials: "The email or password is incorrect. Please try again.",
  unavailable: "We couldn’t reach the sign-in service. Please try again in a moment.",
  signout: "We couldn’t sign you out. Please try again.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  if (!getSupabaseConfig() || !getOwnerEmail()) redirect("/setup");
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const user = await getDeskUser();
  if (user && errorCode !== "signout") redirect("/");

  return (
    <AuthShell>
      <span className="auth-card-icon"><LockKeyhole size={23} /></span>
      <span className="auth-eyebrow">PRIVATE ACCESS</span>
      <h2>{user ? "Sign out of your desk" : "Welcome back"}</h2>
      <p className="auth-intro">{user ? "Use the button below to end your session on this device." : "Sign in to manage your wholesale business."}</p>
      {errors[errorCode] && <p className="auth-error" role="alert">{errors[errorCode]}</p>}
      {user ? <form action={signOut}><SubmitButton label="Sign out" pendingLabel="Signing out…" /></form> : <form action={signIn} className="auth-form">
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="you@yourbusiness.com" maxLength={254} required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" maxLength={4096} required />
        <SubmitButton />
      </form>}
      <p className="auth-help">Access is reserved for the business owner.</p>
    </AuthShell>
  );
}
