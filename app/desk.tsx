"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { signOut } from "./auth/actions";
import { MAX_BACKUP_FILE_BYTES, parseBackup } from "../lib/backup";
import {
  Archive,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  Download,
  Edit3,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import type {
  DeskState,
  Offer,
  Order,
  OrderStatus,
  Payment,
  Product,
} from "../lib/desk-types";

type View = "overview" | "products" | "offers" | "orders" | "balances" | "settings";
type ProductDraft = Omit<Product, "id" | "createdAt">;
type OfferDraft = Omit<Offer, "id">;
type OrderDraft = Pick<Order, "customer" | "date" | "status" | "items" | "notes">;
type PaymentDraft = Omit<Payment, "id">;

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const nav: { id: View; label: string; icon: typeof Package }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "products", label: "Products", icon: Package },
  { id: "offers", label: "Offers", icon: BadgePercent },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "balances", label: "Balances", icon: Wallet },
  { id: "settings", label: "Settings", icon: Settings2 },
];
const statuses: OrderStatus[] = ["Draft", "Confirmed", "Packing", "Completed", "Cancelled"];

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTime(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toLocalInput(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : localDateTime(parsed);
}

function dateLabel(value: string) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function orderTotal(order: Order | OrderDraft) {
  return order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function paidFor(state: DeskState, orderId: string) {
  return state.payments.filter((payment) => payment.orderId === orderId).reduce((sum, payment) => sum + payment.amount, 0);
}

function dueFor(state: DeskState, order: Order) {
  return order.status === "Draft" || order.status === "Cancelled"
    ? 0
    : Math.max(0, orderTotal(order) - paidFor(state, order.id));
}

function offerStatus(offer: Offer) {
  const now = Date.now();
  if (new Date(offer.startsAt).getTime() > now) return "Upcoming";
  if (new Date(offer.endsAt).getTime() < now) return "Ended";
  return "Active";
}

function activeOffer(state: DeskState, productId: string) {
  return state.offers.find((offer) => offer.productId === productId && offerStatus(offer) === "Active");
}

function newProductDraft(): ProductDraft {
  return { code: "", name: "", category: "", pack: "", units: 1, cost: 0, rrp: 0, image: "", active: true };
}

function newOfferDraft(): OfferDraft {
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { productId: "", offerPrice: 0, startsAt: localDateTime(start), endsAt: localDateTime(end) };
}

function newOrderDraft(): OrderDraft {
  return { customer: "", date: today(), status: "Draft", items: [], notes: "" };
}

function newPaymentDraft(): PaymentDraft {
  return { orderId: "", amount: 0, date: today(), method: "Bank transfer", note: "" };
}

function formatAmount(value: number) {
  return money.format(Number.isFinite(value) ? value : 0);
}

function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="desk-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`desk-modal ${wide ? "desk-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="desk-modal-title">
        <header className="desk-modal-header">
          <div><h2 id="desk-modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="desk-icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Package; title: string; text: string; action?: ReactNode }) {
  return <div className="desk-empty"><div className="desk-empty-icon"><Icon size={24} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`desk-status desk-status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}

export default function Desk({ userName }: { userName: string }) {
  const [state, setState] = useState<DeskState | null>(null);
  const stateRef = useRef<DeskState | null>(null);
  const confirmedRef = useRef<DeskState | null>(null);
  const versionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const epochRef = useRef(0);
  const mutationRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [notice, setNotice] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(newProductDraft());
  const [offerOpen, setOfferOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(newOfferDraft());
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(newOrderDraft());
  const [addItemId, setAddItemId] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(newPaymentDraft());
  const [formError, setFormError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [showArchived, setShowArchived] = useState(false);
  const [offerSearch, setOfferSearch] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("All statuses");
  const [settingsDraft, setSettingsDraft] = useState<DeskState["settings"]>({ businessName: "GrandSave", contactName: "", email: "", phone: "" });
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [importedState, setImportedState] = useState<DeskState | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load your desk (${response.status}).`);
    const data = await response.json() as { state: DeskState; version: number };
    if (!data.state || typeof data.version !== "number") throw new Error("The saved data could not be read.");
    stateRef.current = data.state;
    confirmedRef.current = data.state;
    versionRef.current = data.version;
    setState(data.state);
    setSettingsDraft(data.state.settings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Unable to load your desk."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const commit = useCallback((change: (current: DeskState) => DeskState) => {
    const current = stateRef.current;
    if (!current) return;
    const next = change(current);
    stateRef.current = next;
    setState(next);
    setNotice("");
    setSaveStatus("saving");
    const epoch = epochRef.current;
    const mutation = ++mutationRef.current;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (epoch !== epochRef.current) return;
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, version: versionRef.current }),
      });
      if (!response.ok) {
        if (response.status === 409) throw new Error("This desk was updated in another tab. The latest saved version has been loaded.");
        throw new Error(`Your change could not be saved (${response.status}). The last saved version has been restored.`);
      }
      const data = await response.json() as { version: number };
      versionRef.current = data.version;
      confirmedRef.current = next;
      if (mutation === mutationRef.current) setSaveStatus("saved");
    }).catch(async (error) => {
      if (epoch !== epochRef.current) return;
      epochRef.current += 1;
      setSaveStatus("error");
      setNotice(error instanceof Error ? error.message : "Your change could not be saved.");
      try { await load(); } catch { if (confirmedRef.current) { stateRef.current = confirmedRef.current; setState(confirmedRef.current); } }
    });
  }, [load]);

  const closeForms = () => { setProductOpen(false); setOfferOpen(false); setOrderOpen(false); setPaymentOpen(false); setFormError(""); };
  const openProduct = (product?: Product) => { closeForms(); setEditingProduct(product ?? null); setProductDraft(product ? { code: product.code, name: product.name, category: product.category, pack: product.pack, units: product.units, cost: product.cost, rrp: product.rrp, image: product.image, active: product.active } : newProductDraft()); setProductOpen(true); };
  const openOffer = (offer?: Offer) => { closeForms(); setEditingOffer(offer ?? null); setOfferDraft(offer ? { productId: offer.productId, offerPrice: offer.offerPrice, startsAt: toLocalInput(offer.startsAt), endsAt: toLocalInput(offer.endsAt) } : newOfferDraft()); setOfferOpen(true); };
  const openOrder = (order?: Order) => { closeForms(); setEditingOrder(order ?? null); setOrderDraft(order ? { customer: order.customer, date: order.date, status: order.status, items: order.items.map((item) => ({ ...item })), notes: order.notes } : newOrderDraft()); setAddItemId(""); setOrderOpen(true); };
  const openPayment = (orderId?: string) => { closeForms(); setPaymentDraft({ ...newPaymentDraft(), orderId: orderId ?? "" }); setPaymentOpen(true); };

  const products = state?.products ?? [];
  const offers = state?.offers ?? [];
  const orders = state?.orders ?? [];
  const payments = state?.payments ?? [];
  const activeProducts = products.filter((product) => product.active);
  const categories = useMemo(() => ["All categories", ...Array.from(new Set(products.map((product) => product.category.trim()).filter(Boolean))).sort()], [products]);
  const filteredProducts = products.filter((product) => (showArchived || product.active) && (category === "All categories" || product.category === category) && `${product.code} ${product.name} ${product.pack} ${product.category}`.toLowerCase().includes(productSearch.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const filteredOffers = offers.filter((offer) => { const product = products.find((candidate) => candidate.id === offer.productId); return `${product?.name ?? ""} ${product?.code ?? ""}`.toLowerCase().includes(offerSearch.toLowerCase()); }).sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const filteredOrders = orders.filter((order) => (orderStatusFilter === "All statuses" || order.status === orderStatusFilter) && `${order.reference} ${order.customer}`.toLowerCase().includes(orderSearch.toLowerCase())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalDue = state ? orders.reduce((sum, order) => sum + dueFor(state, order), 0) : 0;
  const totalCollected = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const activeOffers = offers.filter((offer) => offerStatus(offer) === "Active").length;
  const ordersToday = orders.filter((order) => order.date === today()).length;
  const eligibleOrders = state ? orders.filter((order) => dueFor(state, order) > 0) : [];
  const selectedPaymentOrder = orders.find((order) => order.id === paymentDraft.orderId);

  function submitProduct(event: FormEvent) {
    event.preventDefault();
    const code = productDraft.code.trim();
    const name = productDraft.name.trim();
    if (!code || !name) { setFormError("Product code and name are required."); return; }
    if (products.some((product) => product.id !== editingProduct?.id && product.code.toLowerCase() === code.toLowerCase())) { setFormError("This product code is already in use."); return; }
    if (!Number.isFinite(productDraft.cost) || productDraft.cost < 0 || !Number.isFinite(productDraft.rrp) || productDraft.rrp < 0 || !Number.isInteger(productDraft.units) || productDraft.units < 1) { setFormError("Enter valid prices and at least one unit per pack."); return; }
    const next: Product = { ...productDraft, code, name, category: productDraft.category.trim(), pack: productDraft.pack.trim(), image: productDraft.image.trim(), id: editingProduct?.id ?? crypto.randomUUID(), createdAt: editingProduct?.createdAt ?? new Date().toISOString() };
    commit((current) => ({ ...current, products: editingProduct ? current.products.map((product) => product.id === editingProduct.id ? next : product) : [...current.products, next] }));
    closeForms();
  }

  function submitOffer(event: FormEvent) {
    event.preventDefault();
    const product = products.find((item) => item.id === offerDraft.productId);
    if (!product) { setFormError("Choose a product."); return; }
    if (!Number.isFinite(offerDraft.offerPrice) || offerDraft.offerPrice <= 0 || offerDraft.offerPrice >= product.cost) { setFormError("Offer price must be above £0 and below the regular pack price."); return; }
    const start = new Date(offerDraft.startsAt);
    const end = new Date(offerDraft.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) { setFormError("Set an end time later than the start time."); return; }
    const next: Offer = { id: editingOffer?.id ?? crypto.randomUUID(), productId: offerDraft.productId, offerPrice: offerDraft.offerPrice, startsAt: start.toISOString(), endsAt: end.toISOString() };
    commit((current) => ({ ...current, offers: editingOffer ? current.offers.map((offer) => offer.id === editingOffer.id ? next : offer) : [...current.offers, next] }));
    closeForms();
  }

  function addOrderItem() {
    const product = products.find((item) => item.id === addItemId);
    if (!product) return;
    const offer = state ? activeOffer(state, product.id) : undefined;
    setOrderDraft((draft) => ({ ...draft, items: [...draft.items, { productId: product.id, name: product.name, code: product.code, quantity: 1, unitPrice: offer?.offerPrice ?? product.cost }] }));
    setAddItemId("");
  }

  function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!orderDraft.customer.trim()) { setFormError("Enter the customer or order name."); return; }
    if (!orderDraft.date) { setFormError("Choose an order date."); return; }
    if (orderDraft.items.length === 0) { setFormError("Add at least one product."); return; }
    if (orderDraft.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) { setFormError("Check item quantities and prices."); return; }
    const now = new Date().toISOString();
    const reference = editingOrder?.reference ?? `GS-${today().replaceAll("-", "")}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    const next: Order = { ...orderDraft, customer: orderDraft.customer.trim(), notes: orderDraft.notes.trim(), id: editingOrder?.id ?? crypto.randomUUID(), reference, createdAt: editingOrder?.createdAt ?? now, updatedAt: now };
    commit((current) => ({ ...current, orders: editingOrder ? current.orders.map((order) => order.id === editingOrder.id ? next : order) : [...current.orders, next] }));
    closeForms();
  }

  function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!state) return;
    const order = orders.find((item) => item.id === paymentDraft.orderId);
    if (!order) { setFormError("Choose an order with a balance due."); return; }
    const due = dueFor(state, order);
    if (!Number.isFinite(paymentDraft.amount) || paymentDraft.amount <= 0 || paymentDraft.amount > due + 0.001) { setFormError(`Enter an amount above £0 and no more than ${formatAmount(due)}.`); return; }
    if (!paymentDraft.date) { setFormError("Choose a payment date."); return; }
    const next: Payment = { ...paymentDraft, id: crypto.randomUUID(), amount: Math.round(paymentDraft.amount * 100) / 100, note: paymentDraft.note.trim() };
    commit((current) => ({ ...current, payments: [...current.payments, next] }));
    closeForms();
  }

  function exportData() {
    if (!state) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `grandsave-order-desk-${today()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readBackup(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error("Choose a backup smaller than 5 MB.");
      setImportedState(parseBackup(await file.text()));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The backup could not be read.");
    }
  }

  const title = nav.find((item) => item.id === view)?.label ?? "Overview";
  const businessName = state?.settings.businessName?.trim() || "GrandSave";

  return (
    <div className="desk-shell">
      <aside className={`desk-sidebar ${mobileMenu ? "desk-sidebar-open" : ""}`}>
        <div className="desk-brand"><span className="desk-brand-mark"><ShoppingBag size={22} strokeWidth={2.2} /></span><span><strong>{businessName}</strong><small>ORDER DESK</small></span></div>
        <div className="desk-sidebar-rule" />
        <span className="desk-nav-heading">WORKSPACE</span>
        <nav className="desk-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`desk-nav-item ${view === id ? "desk-nav-active" : ""}`} onClick={() => { setView(id); setMobileMenu(false); }} aria-current={view === id ? "page" : undefined}><Icon size={18} /><span>{label}</span>{id === "orders" && orders.length > 0 && <em>{orders.length}</em>}</button>)}
        </nav>
        <div className="desk-sidebar-bottom"><div className="desk-private-note"><CheckCircle2 size={18} /><div><strong>Private workspace</strong><span>Only your signed-in account can view this desk.</span></div></div><div className="desk-sidebar-user"><span className="desk-avatar">{(userName || businessName).charAt(0).toUpperCase()}</span><span><strong>{userName || "My account"}</strong><small>Desk owner</small></span></div><form action={signOut} className="desk-signout-form"><button type="submit" disabled={saveStatus === "saving"}><LogOut size={15} />Sign out</button></form></div>
      </aside>
      {mobileMenu && <button className="desk-mobile-shade" type="button" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
      <div className="desk-main-area">
        <header className="desk-topbar"><button className="desk-mobile-menu desk-icon-button" type="button" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><div className="desk-breadcrumb"><span>Workspace</span><span className="desk-breadcrumb-slash">/</span><strong>{title}</strong></div><div className="desk-topbar-right"><span className={`desk-save-indicator desk-save-${saveStatus}`}>{saveStatus === "saved" ? <Check size={14} /> : saveStatus === "saving" ? <Clock3 size={14} /> : <CircleAlert size={14} />}{saveStatus === "saved" ? "All changes saved" : saveStatus === "saving" ? "Saving…" : "Save problem"}</span><span className="desk-top-avatar">{(userName || businessName).charAt(0).toUpperCase()}</span></div></header>
        <main className="desk-content">
          {notice && <div className="desk-notice" role="alert"><CircleAlert size={18} /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}
          {loading && <div className="desk-loading"><span className="desk-spinner" />Loading your order desk…</div>}
          {!loading && !state && <Empty icon={CircleAlert} title="Your desk could not be loaded" text="Please check your connection and try again." action={<button className="desk-button desk-button-primary" type="button" onClick={() => { setLoading(true); load().catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load your desk.")).finally(() => setLoading(false)); }}>Try again</button>} />}
          {state && view === "overview" && <>
            <div className="desk-page-title"><div><span className="desk-eyebrow">YOUR WORKSPACE</span><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {userName?.split(" ")[0] || "there"} <span className="desk-wave">✳</span></h1><p>Manage products, orders and payments in one place.</p></div><button className="desk-button desk-button-primary" type="button" onClick={() => openOrder()} disabled={!activeProducts.length}><Plus size={17} />New order</button></div>
            <div className="desk-hero"><div className="desk-hero-copy"><span className="desk-hero-kicker"><span /> GRANDSAVE ORDER DESK</span><h2>Your wholesale work,<br />all in one place.</h2><p>Add your own products, record orders and stay on top of what&apos;s owed.</p><button className="desk-button desk-button-light" type="button" onClick={() => { setView("products"); openProduct(); }}>Add your first product <ArrowRight size={17} /></button></div><div className="desk-hero-art" aria-hidden="true"><div className="desk-art-ring desk-art-ring-1" /><div className="desk-art-ring desk-art-ring-2" /><div className="desk-art-card desk-art-card-back" /><div className="desk-art-card desk-art-card-front"><span className="desk-art-line wide" /><span className="desk-art-line" /><span className="desk-art-blocks"><i /><i /><i /></span></div></div></div>
            <div className="desk-stat-grid"><div className="desk-stat-card"><span className="desk-stat-icon blue"><Package size={20} /></span><span className="desk-stat-label">Active products</span><strong>{activeProducts.length}</strong><span className="desk-stat-foot">In your catalogue</span></div><div className="desk-stat-card"><span className="desk-stat-icon lilac"><ShoppingBag size={20} /></span><span className="desk-stat-label">Orders today</span><strong>{ordersToday}</strong><span className="desk-stat-foot">{dateLabel(today())}</span></div><div className="desk-stat-card"><span className="desk-stat-icon amber"><Wallet size={20} /></span><span className="desk-stat-label">Balance due</span><strong>{formatAmount(totalDue)}</strong><span className="desk-stat-foot">Across {eligibleOrders.length} order{eligibleOrders.length === 1 ? "" : "s"}</span></div><div className="desk-stat-card"><span className="desk-stat-icon green"><BadgePercent size={20} /></span><span className="desk-stat-label">Live offers</span><strong>{activeOffers}</strong><span className="desk-stat-foot">Available right now</span></div></div>
            <div className="desk-two-col"><section className="desk-card"><div className="desk-card-heading"><div><h2>Recent orders</h2><p>Your latest order activity</p></div><button className="desk-text-action" type="button" onClick={() => setView("orders")}>View all <ArrowRight size={15} /></button></div>{orders.length ? <div className="desk-compact-orders">{[...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((order) => <button className="desk-compact-order" type="button" key={order.id} onClick={() => openOrder(order)}><span className="desk-order-mini-icon"><ShoppingBag size={18} /></span><span className="desk-compact-main"><strong>{order.customer}</strong><small>{order.reference} · {dateLabel(order.date)}</small></span><StatusPill status={order.status} /><strong>{formatAmount(orderTotal(order))}</strong></button>)}</div> : <Empty icon={ShoppingBag} title="No orders yet" text="Once you record an order, it will appear here." action={<button className="desk-button desk-button-secondary" type="button" onClick={() => openOrder()}>Create an order</button>} />}</section><section className="desk-card"><div className="desk-card-heading"><div><h2>Quick start</h2><p>Set up your private desk</p></div></div><div className="desk-quick-steps"><button type="button" onClick={() => { setView("products"); openProduct(); }}><span className={products.length ? "done" : ""}>{products.length ? <Check size={16} /> : "1"}</span><span><strong>Add your products</strong><small>Build a catalogue with your prices and packs.</small></span><ArrowRight size={17} /></button><button type="button" onClick={() => { setView("orders"); openOrder(); }}><span className={orders.length ? "done" : ""}>{orders.length ? <Check size={16} /> : "2"}</span><span><strong>Record an order</strong><small>Choose products, quantities and a customer.</small></span><ArrowRight size={17} /></button><button type="button" onClick={() => setView("balances")}><span className={payments.length ? "done" : ""}>{payments.length ? <Check size={16} /> : "3"}</span><span><strong>Track a payment</strong><small>Keep outstanding balances up to date.</small></span><ArrowRight size={17} /></button></div></section></div>
          </>}
          {state && view === "products" && <><div className="desk-page-title"><div><span className="desk-eyebrow">CATALOGUE</span><h1>Products</h1><p>Add and manage products for your own order records.</p></div><button className="desk-button desk-button-primary" type="button" onClick={() => openProduct()}><Plus size={17} />Add product</button></div><div className="desk-card desk-table-card"><div className="desk-table-toolbar"><div className="desk-search"><Search size={18} /><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search name, code or pack" aria-label="Search products" /></div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">{categories.map((item) => <option key={item}>{item}</option>)}</select><label className="desk-switch-label"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label></div><div className="desk-table-meta"><strong>{filteredProducts.length}</strong> product{filteredProducts.length === 1 ? "" : "s"} shown <span>{activeProducts.length} active in catalogue</span></div>{filteredProducts.length ? <div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>Product</th><th>Code</th><th>Category / pack</th><th>Cost / pack</th><th>RRP / unit</th><th>Retail markup</th><th>Status</th><th><span className="desk-sr-only">Actions</span></th></tr></thead><tbody>{filteredProducts.map((product) => { const markup = product.cost > 0 && product.rrp > 0 ? ((product.rrp * product.units - product.cost) / product.cost) * 100 : null; return <tr key={product.id}><td><div className="desk-product-cell"><span className="desk-product-thumb">{product.image ? <img src={product.image} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Package size={19} />}</span><strong>{product.name}</strong></div></td><td className="desk-mono">{product.code}</td><td>{product.category || "Uncategorised"}<small>{product.pack || `${product.units} unit${product.units === 1 ? "" : "s"}`}</small></td><td className="desk-price">{formatAmount(product.cost)}</td><td>{product.rrp ? formatAmount(product.rrp) : "—"}</td><td>{markup === null ? "—" : <span className={markup >= 0 ? "desk-positive" : "desk-negative"}>{markup.toFixed(1)}%</span>}</td><td><StatusPill status={product.active ? "Active" : "Archived"} /></td><td><div className="desk-row-actions"><button type="button" title="Edit product" aria-label={`Edit ${product.name}`} onClick={() => openProduct(product)}><Edit3 size={16} /></button><button type="button" title={product.active ? "Archive product" : "Restore product"} aria-label={`${product.active ? "Archive" : "Restore"} ${product.name}`} onClick={() => commit((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, active: !item.active } : item) }))}>{product.active ? <Archive size={16} /> : <Check size={16} />}</button></div></td></tr>; })}</tbody></table></div> : <Empty icon={Package} title={products.length ? "No matching products" : "Your catalogue is empty"} text={products.length ? "Try a different search or filter." : "Add your first product with its pack price and details."} action={!products.length && <button className="desk-button desk-button-secondary" type="button" onClick={() => openProduct()}>Add product</button>} />}</div></>}
          {state && view === "offers" && <><div className="desk-page-title"><div><span className="desk-eyebrow">PROMOTIONS</span><h1>Offers</h1><p>Create timed prices for products in your catalogue.</p></div><button className="desk-button desk-button-primary" type="button" onClick={() => openOffer()} disabled={!activeProducts.length}><Plus size={17} />New offer</button></div><div className="desk-card desk-table-card"><div className="desk-table-toolbar"><div className="desk-search"><Search size={18} /><input value={offerSearch} onChange={(event) => setOfferSearch(event.target.value)} placeholder="Search offers" aria-label="Search offers" /></div><span className="desk-toolbar-hint">{activeOffers} live now</span></div>{filteredOffers.length ? <div className="desk-offer-grid">{filteredOffers.map((offer) => { const product = products.find((item) => item.id === offer.productId); const saving = product ? Math.max(0, product.cost - offer.offerPrice) : 0; return <article className="desk-offer-card" key={offer.id}><div className="desk-offer-top"><span className="desk-offer-badge"><BadgePercent size={15} /> SPECIAL PRICE</span><StatusPill status={offerStatus(offer)} /></div><span className="desk-offer-product-icon"><Package size={25} /></span><h3>{product?.name || "Removed product"}</h3><p>{product?.code || "—"} · {product?.pack || `${product?.units ?? 1} units`}</p><div className="desk-offer-prices"><strong>{formatAmount(offer.offerPrice)}</strong><s>{formatAmount(product?.cost ?? 0)}</s><span>Save {formatAmount(saving)}</span></div><div className="desk-offer-dates"><Clock3 size={15} />{dateLabel(offer.startsAt)} – {dateLabel(offer.endsAt)}</div><div className="desk-offer-actions"><button className="desk-button desk-button-secondary" type="button" onClick={() => openOffer(offer)}><Edit3 size={15} />Edit</button><button className="desk-icon-button" type="button" aria-label={`Delete offer for ${product?.name || "product"}`} title="Delete offer" onClick={() => { if (window.confirm("Delete this offer?")) commit((current) => ({ ...current, offers: current.offers.filter((item) => item.id !== offer.id) })); }}><Trash2 size={16} /></button></div></article>; })}</div> : <Empty icon={BadgePercent} title={offers.length ? "No matching offers" : "No offers yet"} text={offers.length ? "Try a different search." : activeProducts.length ? "Create a limited-time price for a product." : "Add a product first, then create an offer."} action={activeProducts.length > 0 && !offers.length && <button className="desk-button desk-button-secondary" type="button" onClick={() => openOffer()}>Create offer</button>} />}</div></>}
          {state && view === "orders" && <><div className="desk-page-title"><div><span className="desk-eyebrow">ORDER MANAGEMENT</span><h1>Orders</h1><p>Record and update your wholesale orders.</p></div><button className="desk-button desk-button-primary" type="button" onClick={() => openOrder()} disabled={!activeProducts.length}><Plus size={17} />New order</button></div><div className="desk-card desk-table-card"><div className="desk-table-toolbar"><div className="desk-search"><Search size={18} /><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search order or customer" aria-label="Search orders" /></div><select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)} aria-label="Filter order status"><option>All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></div><div className="desk-table-meta"><strong>{filteredOrders.length}</strong> order{filteredOrders.length === 1 ? "" : "s"} shown</div>{filteredOrders.length ? <div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>Order</th><th>Customer / name</th><th>Date</th><th>Items</th><th>Total</th><th>Balance due</th><th>Status</th><th><span className="desk-sr-only">Actions</span></th></tr></thead><tbody>{filteredOrders.map((order) => <tr key={order.id}><td><strong className="desk-linkish">{order.reference}</strong></td><td>{order.customer}</td><td>{dateLabel(order.date)}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td className="desk-price">{formatAmount(orderTotal(order))}</td><td className="desk-price">{formatAmount(dueFor(state, order))}</td><td><StatusPill status={order.status} /></td><td><button className="desk-row-edit" type="button" onClick={() => openOrder(order)} aria-label={`Edit order ${order.reference}`}>View / edit <ArrowRight size={15} /></button></td></tr>)}</tbody></table></div> : <Empty icon={ShoppingBag} title={orders.length ? "No matching orders" : "No orders recorded"} text={orders.length ? "Try another search or status." : activeProducts.length ? "Create your first order from your product catalogue." : "Add products to your catalogue, then record an order."} action={activeProducts.length > 0 && !orders.length && <button className="desk-button desk-button-secondary" type="button" onClick={() => openOrder()}>Create order</button>} />}</div><p className="desk-page-footnote">Orders are private records in this desk. They are not sent to a supplier or customer.</p></>}
          {state && view === "balances" && <><div className="desk-page-title"><div><span className="desk-eyebrow">PAYMENT TRACKING</span><h1>Balances</h1><p>See what is outstanding and record payments received.</p></div><button className="desk-button desk-button-primary" type="button" onClick={() => openPayment()} disabled={!eligibleOrders.length}><Plus size={17} />Record payment</button></div><div className="desk-balance-stats"><div className="desk-balance-stat dark"><span>Outstanding balance</span><strong>{formatAmount(totalDue)}</strong><small>{eligibleOrders.length} unpaid order{eligibleOrders.length === 1 ? "" : "s"}</small><ArrowUpRight size={21} /></div><div className="desk-balance-stat"><span>Total collected</span><strong>{formatAmount(totalCollected)}</strong><small>Across {payments.length} payment{payments.length === 1 ? "" : "s"}</small><ArrowDownRight size={21} /></div></div><div className="desk-two-col desk-balance-columns"><section className="desk-card"><div className="desk-card-heading"><div><h2>Order balances</h2><p>Confirmed, packing and completed orders</p></div></div>{orders.filter((order) => order.status !== "Draft" && order.status !== "Cancelled").length ? <div className="desk-balance-list">{orders.filter((order) => order.status !== "Draft" && order.status !== "Cancelled").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((order) => <div className="desk-balance-row" key={order.id}><span className="desk-order-mini-icon"><ShoppingBag size={17} /></span><span className="desk-balance-main"><strong>{order.customer}</strong><small>{order.reference} · {dateLabel(order.date)}</small></span><span className="desk-balance-values"><strong>{formatAmount(dueFor(state, order))}</strong><small>of {formatAmount(orderTotal(order))}</small></span>{dueFor(state, order) > 0 && <button className="desk-small-plus" type="button" title="Record payment" aria-label={`Record payment for ${order.reference}`} onClick={() => openPayment(order.id)}><Plus size={16} /></button>}</div>)}</div> : <Empty icon={Wallet} title="No balances yet" text="Confirmed orders and their balances will appear here." />}</section><section className="desk-card"><div className="desk-card-heading"><div><h2>Payment history</h2><p>Money you have recorded as received</p></div></div>{payments.length ? <div className="desk-payment-list">{[...payments].sort((a, b) => b.date.localeCompare(a.date)).map((payment) => { const order = orders.find((item) => item.id === payment.orderId); return <div className="desk-payment-row" key={payment.id}><span className="desk-payment-icon"><CreditCard size={17} /></span><span className="desk-balance-main"><strong>{payment.method}</strong><small>{order?.reference || "Order removed"} · {dateLabel(payment.date)}{payment.note ? ` · ${payment.note}` : ""}</small></span><strong className="desk-positive">+{formatAmount(payment.amount)}</strong><button className="desk-row-delete" type="button" aria-label={`Delete payment of ${formatAmount(payment.amount)}`} title="Delete payment" onClick={() => { if (window.confirm("Delete this payment entry? The balance due will increase.")) commit((current) => ({ ...current, payments: current.payments.filter((item) => item.id !== payment.id) })); }}><Trash2 size={15} /></button></div>; })}</div> : <Empty icon={CreditCard} title="No payments recorded" text="When you record a payment, it will appear here." />}</section></div></>}
          {state && view === "settings" && <><div className="desk-page-title"><div><span className="desk-eyebrow">PREFERENCES</span><h1>Settings</h1><p>Personalise your private order desk and keep a backup.</p></div></div><div className="desk-settings-grid"><section className="desk-card desk-settings-card"><div className="desk-card-heading"><div><h2>Business details</h2><p>Shown only in your private workspace</p></div></div><form onSubmit={(event) => { event.preventDefault(); if (!settingsDraft.businessName.trim()) { setNotice("Business name is required."); return; } commit((current) => ({ ...current, settings: { ...settingsDraft, businessName: settingsDraft.businessName.trim() } })); }}><div className="desk-form-grid"><label className="desk-field"><span>Business name *</span><input value={settingsDraft.businessName} onChange={(event) => setSettingsDraft({ ...settingsDraft, businessName: event.target.value })} required /></label><label className="desk-field"><span>Contact name</span><input value={settingsDraft.contactName} onChange={(event) => setSettingsDraft({ ...settingsDraft, contactName: event.target.value })} /></label><label className="desk-field"><span>Email address</span><input type="email" value={settingsDraft.email} onChange={(event) => setSettingsDraft({ ...settingsDraft, email: event.target.value })} /></label><label className="desk-field"><span>Phone number</span><input type="tel" value={settingsDraft.phone} onChange={(event) => setSettingsDraft({ ...settingsDraft, phone: event.target.value })} /></label></div><button className="desk-button desk-button-primary desk-settings-save" type="submit"><Check size={16} />Save details</button></form></section><section className="desk-card desk-settings-card"><div className="desk-card-heading"><div><h2>Your data</h2><p>Keep a copy of your records</p></div></div><div className="desk-backup-panel"><span><Download size={24} /></span><h3>Download a backup</h3><p>Export your products, offers, orders, payments and settings as a JSON file.</p><button className="desk-button desk-button-secondary" type="button" onClick={exportData}><Download size={16} />Download backup</button><input ref={backupFileRef} type="file" accept=".json,application/json" className="desk-sr-only" aria-label="Choose GrandSave backup" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readBackup(file); }} /><button className="desk-button desk-button-ghost desk-import-button" type="button" disabled={saveStatus === "saving"} onClick={() => backupFileRef.current?.click()}><Upload size={16} />Import backup</button><p>Transfer records from your previous GrandSave desk using its downloaded backup.</p></div><div className="desk-data-counts"><span>{products.length} products</span><span>{orders.length} orders</span><span>{payments.length} payments</span></div></section></div></>}
        </main>
      </div>
      {importedState && <Modal title="Import backup" subtitle="Review the records before replacing your current desk." onClose={() => setImportedState(null)}>
        <div className="desk-modal-body">
          <p className="desk-import-summary">{importedState.products.length} products · {importedState.offers.length} offers · {importedState.orders.length} orders · {importedState.payments.length} payments</p>
          <p className="desk-inline-warning">Importing replaces the records and settings in this desk. Download a backup of your current records first if you want to keep them.</p>
          <div className="desk-modal-footer">
            <button className="desk-button desk-button-ghost" type="button" onClick={() => setImportedState(null)}>Cancel</button>
            <button className="desk-button desk-button-primary" type="button" disabled={saveStatus === "saving"} onClick={() => { const restored = importedState; commit(() => restored); setSettingsDraft(restored.settings); setImportedState(null); }}>Replace records</button>
          </div>
        </div>
      </Modal>}
      {productOpen && <Modal title={editingProduct ? "Edit product" : "Add product"} subtitle="Enter the details you want to use in your orders." onClose={closeForms} wide><form className="desk-modal-body" onSubmit={submitProduct}><div className="desk-form-grid"><label className="desk-field"><span>Product name *</span><input autoFocus value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} placeholder="e.g. Chocolate multipack" required /></label><label className="desk-field"><span>Product code *</span><input value={productDraft.code} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value })} placeholder="e.g. CHOC-001" required /></label><label className="desk-field"><span>Category</span><input value={productDraft.category} onChange={(event) => setProductDraft({ ...productDraft, category: event.target.value })} placeholder="e.g. Confectionery" /></label><label className="desk-field"><span>Pack description</span><input value={productDraft.pack} onChange={(event) => setProductDraft({ ...productDraft, pack: event.target.value })} placeholder="e.g. Case of 24 × 52g" /></label><label className="desk-field"><span>Units per pack *</span><input type="number" min="1" step="1" value={productDraft.units} onChange={(event) => setProductDraft({ ...productDraft, units: Number(event.target.value) })} required /></label><label className="desk-field"><span>Cost per pack (£) *</span><input type="number" min="0" step="0.01" value={productDraft.cost} onChange={(event) => setProductDraft({ ...productDraft, cost: Number(event.target.value) })} required /></label><label className="desk-field"><span>RRP per unit (£)</span><input type="number" min="0" step="0.01" value={productDraft.rrp} onChange={(event) => setProductDraft({ ...productDraft, rrp: Number(event.target.value) })} /></label><label className="desk-field"><span>Image URL (optional)</span><input type="url" value={productDraft.image} onChange={(event) => setProductDraft({ ...productDraft, image: event.target.value })} placeholder="https://…" /></label></div><label className="desk-checkbox-field"><input type="checkbox" checked={productDraft.active} onChange={(event) => setProductDraft({ ...productDraft, active: event.target.checked })} />Active in catalogue</label>{formError && <p className="desk-form-error" role="alert">{formError}</p>}<div className="desk-modal-footer"><button className="desk-button desk-button-ghost" type="button" onClick={closeForms}>Cancel</button><button className="desk-button desk-button-primary" type="submit">{editingProduct ? "Save product" : "Add product"}</button></div></form></Modal>}
      {offerOpen && <Modal title={editingOffer ? "Edit offer" : "Create offer"} subtitle="Set a special pack price for a limited time." onClose={closeForms}><form className="desk-modal-body" onSubmit={submitOffer}><div className="desk-form-grid single"><label className="desk-field"><span>Product *</span><select value={offerDraft.productId} onChange={(event) => setOfferDraft({ ...offerDraft, productId: event.target.value })} required><option value="">Choose a product</option>{products.filter((product) => product.active || product.id === offerDraft.productId).map((product) => <option key={product.id} value={product.id}>{product.name} — {formatAmount(product.cost)}</option>)}</select></label><label className="desk-field"><span>Offer price per pack (£) *</span><input type="number" min="0.01" step="0.01" value={offerDraft.offerPrice} onChange={(event) => setOfferDraft({ ...offerDraft, offerPrice: Number(event.target.value) })} required /></label></div><div className="desk-form-grid"><label className="desk-field"><span>Starts *</span><input type="datetime-local" value={offerDraft.startsAt} onChange={(event) => setOfferDraft({ ...offerDraft, startsAt: event.target.value })} required /></label><label className="desk-field"><span>Ends *</span><input type="datetime-local" value={offerDraft.endsAt} onChange={(event) => setOfferDraft({ ...offerDraft, endsAt: event.target.value })} required /></label></div>{formError && <p className="desk-form-error" role="alert">{formError}</p>}<div className="desk-modal-footer"><button className="desk-button desk-button-ghost" type="button" onClick={closeForms}>Cancel</button><button className="desk-button desk-button-primary" type="submit">{editingOffer ? "Save offer" : "Create offer"}</button></div></form></Modal>}
      {orderOpen && <Modal title={editingOrder ? `Order ${editingOrder.reference}` : "Create order"} subtitle="Record an internal order from your catalogue." onClose={closeForms} wide><form className="desk-modal-body" onSubmit={submitOrder}><div className="desk-form-grid"><label className="desk-field"><span>Customer / order name *</span><input autoFocus value={orderDraft.customer} onChange={(event) => setOrderDraft({ ...orderDraft, customer: event.target.value })} placeholder="Name this order" required /></label><label className="desk-field"><span>Order date *</span><input type="date" value={orderDraft.date} onChange={(event) => setOrderDraft({ ...orderDraft, date: event.target.value })} required /></label><label className="desk-field"><span>Status</span><select value={orderDraft.status} onChange={(event) => setOrderDraft({ ...orderDraft, status: event.target.value as OrderStatus })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><div className="desk-line-items-head"><h3>Products</h3><span>{orderDraft.items.length} line item{orderDraft.items.length === 1 ? "" : "s"}</span></div><div className="desk-add-item"><select value={addItemId} onChange={(event) => setAddItemId(event.target.value)} aria-label="Choose product to add"><option value="">Choose a product to add</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.code}</option>)}</select><button className="desk-button desk-button-secondary" type="button" onClick={addOrderItem} disabled={!addItemId}><Plus size={16} />Add</button></div>{orderDraft.items.length ? <div className="desk-item-list">{orderDraft.items.map((item, index) => <div className="desk-item-row" key={`${item.productId}-${index}`}><span className="desk-order-mini-icon"><Package size={17} /></span><span className="desk-item-name"><strong>{item.name}</strong><small>{item.code}</small></span><label><span>Qty</span><input type="number" min="1" step="1" value={item.quantity} onChange={(event) => setOrderDraft((draft) => ({ ...draft, items: draft.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Number(event.target.value) } : entry) }))} /></label><label><span>Price / pack</span><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => setOrderDraft((draft) => ({ ...draft, items: draft.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, unitPrice: Number(event.target.value) } : entry) }))} /></label><strong className="desk-item-total">{formatAmount(item.quantity * item.unitPrice)}</strong><button className="desk-row-delete" type="button" aria-label={`Remove ${item.name}`} onClick={() => setOrderDraft((draft) => ({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }))}><X size={17} /></button></div>)}</div> : <div className="desk-items-empty">No products added to this order yet.</div>}<div className="desk-order-total"><span>Order total</span><strong>{formatAmount(orderTotal(orderDraft))}</strong></div><label className="desk-field"><span>Notes</span><textarea value={orderDraft.notes} onChange={(event) => setOrderDraft({ ...orderDraft, notes: event.target.value })} rows={3} placeholder="Optional internal notes" /></label>{editingOrder && paidFor(state!, editingOrder.id) > 0 && <p className="desk-inline-warning"><CircleAlert size={16} />This order has payments recorded. Changing the total or status may change its balance.</p>}{formError && <p className="desk-form-error" role="alert">{formError}</p>}<div className="desk-modal-footer"><button className="desk-button desk-button-ghost" type="button" onClick={closeForms}>Cancel</button><button className="desk-button desk-button-primary" type="submit">{editingOrder ? "Save order" : "Create order"}</button></div></form></Modal>}
      {paymentOpen && <Modal title="Record payment" subtitle="Add a payment received against an order." onClose={closeForms}><form className="desk-modal-body" onSubmit={submitPayment}><div className="desk-form-grid single"><label className="desk-field"><span>Order *</span><select value={paymentDraft.orderId} onChange={(event) => setPaymentDraft({ ...paymentDraft, orderId: event.target.value })} required><option value="">Choose an order</option>{eligibleOrders.map((order) => <option key={order.id} value={order.id}>{order.reference} · {order.customer} · {formatAmount(dueFor(state!, order))} due</option>)}</select></label>{selectedPaymentOrder && state && <div className="desk-payment-due">Balance available to collect <strong>{formatAmount(dueFor(state, selectedPaymentOrder))}</strong></div>}<label className="desk-field"><span>Amount received (£) *</span><input type="number" min="0.01" step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: Number(event.target.value) })} required /></label></div><div className="desk-form-grid"><label className="desk-field"><span>Date *</span><input type="date" value={paymentDraft.date} onChange={(event) => setPaymentDraft({ ...paymentDraft, date: event.target.value })} required /></label><label className="desk-field"><span>Method</span><select value={paymentDraft.method} onChange={(event) => setPaymentDraft({ ...paymentDraft, method: event.target.value })}><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Other</option></select></label></div><label className="desk-field"><span>Note</span><input value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} placeholder="Optional reference" /></label>{formError && <p className="desk-form-error" role="alert">{formError}</p>}<div className="desk-modal-footer"><button className="desk-button desk-button-ghost" type="button" onClick={closeForms}>Cancel</button><button className="desk-button desk-button-primary" type="submit">Save payment</button></div></form></Modal>}
    </div>
  );
}
