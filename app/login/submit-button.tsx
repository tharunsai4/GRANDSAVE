"use client";

import { useFormStatus } from "react-dom";
import { ArrowRight } from "lucide-react";

export default function SubmitButton({ label = "Sign in", pendingLabel = "Signing in…" }: { label?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button className="auth-submit" type="submit" disabled={pending}>{pending ? pendingLabel : label}<ArrowRight size={17} aria-hidden="true" /></button>;
}
