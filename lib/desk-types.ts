export type Product = {
  id: string;
  code: string;
  name: string;
  category: string;
  pack: string;
  units: number;
  cost: number;
  rrp: number;
  image: string;
  active: boolean;
  createdAt: string;
};

export type Offer = {
  id: string;
  productId: string;
  offerPrice: number;
  startsAt: string;
  endsAt: string;
};

export type OrderStatus = "Draft" | "Confirmed" | "Packing" | "Completed" | "Cancelled";

export type OrderItem = {
  productId: string;
  name: string;
  code: string;
  quantity: number;
  unitPrice: number;
};

export type Order = {
  id: string;
  reference: string;
  customer: string;
  date: string;
  status: OrderStatus;
  items: OrderItem[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Payment = {
  id: string;
  orderId: string;
  amount: number;
  date: string;
  method: string;
  note: string;
};

export type DeskSettings = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
};

export type DeskState = {
  products: Product[];
  offers: Offer[];
  orders: Order[];
  payments: Payment[];
  settings: DeskSettings;
};
