import type { DeskState, OrderStatus } from "./desk-types";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasStrings(value: RecordValue, fields: readonly string[]) {
  return fields.every((field) => typeof value[field] === "string");
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isProduct(value: unknown) {
  return isRecord(value) &&
    hasStrings(value, ["id", "code", "name", "category", "pack", "image", "createdAt"]) &&
    isQuantity(value.units) &&
    isAmount(value.cost) &&
    isAmount(value.rrp) &&
    typeof value.active === "boolean";
}

function isOffer(value: unknown) {
  return isRecord(value) &&
    hasStrings(value, ["id", "productId", "startsAt", "endsAt"]) &&
    isAmount(value.offerPrice) && value.offerPrice > 0;
}

function isOrderItem(value: unknown) {
  return isRecord(value) &&
    hasStrings(value, ["productId", "name", "code"]) &&
    isQuantity(value.quantity) &&
    isAmount(value.unitPrice);
}

const orderStatuses: readonly OrderStatus[] = ["Draft", "Confirmed", "Packing", "Completed", "Cancelled"];

function isOrder(value: unknown) {
  return isRecord(value) &&
    hasStrings(value, ["id", "reference", "customer", "date", "notes", "createdAt", "updatedAt"]) &&
    typeof value.status === "string" && orderStatuses.includes(value.status as OrderStatus) &&
    Array.isArray(value.items) && value.items.every(isOrderItem);
}

function isPayment(value: unknown) {
  return isRecord(value) &&
    hasStrings(value, ["id", "orderId", "date", "method", "note"]) &&
    isAmount(value.amount) && value.amount > 0;
}

export function isDeskState(value: unknown): value is DeskState {
  if (!isRecord(value)) return false;
  return Array.isArray(value.products) && value.products.every(isProduct) &&
    Array.isArray(value.offers) && value.offers.every(isOffer) &&
    Array.isArray(value.orders) && value.orders.every(isOrder) &&
    Array.isArray(value.payments) && value.payments.every(isPayment) &&
    isRecord(value.settings) &&
    hasStrings(value.settings, ["businessName", "contactName", "email", "phone"]);
}
