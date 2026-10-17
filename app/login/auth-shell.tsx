import type { ReactNode } from "react";
import { Check, ShieldCheck, ShoppingBag } from "lucide-react";
import "./auth.css";

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="GrandSave Order Desk">
        <a className="auth-brand" href="/"><span><ShoppingBag size={24} /></span><div><strong>GrandSave</strong><small>ORDER DESK</small></div></a>
        <div className="auth-story-copy">
          <span className="auth-eyebrow">YOUR WHOLESALE WORKSPACE</span>
          <h1>Everything in order.<br />All in one place.</h1>
          <p>A clear view of your products, orders and payments, whenever you need it.</p>
          <ul><li><Check size={16} />Keep your catalogue up to date</li><li><Check size={16} />Record orders and special offers</li><li><Check size={16} />Stay on top of outstanding balances</li></ul>
        </div>
        <div className="auth-private"><ShieldCheck size={18} /><span>A private workspace for your business.</span></div>
        <div className="auth-orbit auth-orbit-one" aria-hidden="true" /><div className="auth-orbit auth-orbit-two" aria-hidden="true" />
      </section>
      <section className="auth-form-area"><div className="auth-card">{children}</div><p className="auth-footer">GrandSave Order Desk</p></section>
    </main>
  );
}
