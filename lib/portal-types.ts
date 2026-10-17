export type PortalRole = "owner" | "customer" | "pending";
export type PortalUser = { id: string; email: string; displayName: string; role: PortalRole };
export type PortalProduct = {
  id: string; code: string; name: string; category: string; pack: string;
  units: number; price: number; rrp: number; image: string; active: boolean;
  created_at: string; updated_at: string;
};
export type PortalOffer = {
  id: string; product_id: string; price: number; starts_at: string;
  ends_at: string; created_at: string;
};
export type PortalCustomer = {
  id: string; name: string; business_name: string; email: string;
  phone: string; address: string; access_key: string | null; access_enabled: boolean;
  approved: boolean; created_at: string; updated_at: string;
};
export type PortalOrderStatus = "Draft" | "Placed" | "Confirmed" | "Packing" | "Completed" | "Cancelled";
export type PortalOrder = {
  id: string; reference: string; customer_id: string; request_id: string | null;
  date: string; status: PortalOrderStatus; notes: string; total: number;
  created_at: string; updated_at: string;
};
export type PortalOrderItem = {
  id: string; order_id: string; product_id: string; name: string; code: string;
  pack: string; quantity: number; unit_price: number;
};
export type PortalPayment = {
  id: string; order_id: string; amount: number; date: string; method: string;
  note: string; created_at: string;
};
export type PortalSettings = {
  id: boolean; business_name: string; contact_name: string; email: string;
  phone: string; require_customer_approval: boolean;
};
export type PortalData = {
  user: PortalUser; products: PortalProduct[]; offers: PortalOffer[];
  customers: PortalCustomer[]; orders: PortalOrder[]; items: PortalOrderItem[];
  payments: PortalPayment[]; settings: PortalSettings;
};
