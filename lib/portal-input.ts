export class InputError extends Error {}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Invalid request.");
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new InputError(`Enter a valid ${label}.`);
  }
  const result = value.trim();
  if (result.length > max || (required && !result)) throw new InputError(`Enter ${label}${max ? ` (up to ${max} characters)` : ""}.`);
  return result;
}

export function uuid(value: unknown, label = "record"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InputError(`Choose a valid ${label}.`);
  }
  return value.toLowerCase();
}

export function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new InputError(`Choose a valid ${label}.`);
  return value;
}

export function amount(value: unknown, label: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > 9_999_999_999.99) {
    throw new InputError(`Enter a valid ${label}.`);
  }
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(rounded - value) > 0.0000001) throw new InputError(`${label} must have at most two decimal places.`);
  return rounded;
}

export function orderItems(value: unknown): { product_id: string; quantity: number }[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new InputError("Choose between 1 and 100 product lines.");
  const seen = new Set<string>();
  return value.map((entry) => {
    const item = record(entry);
    const product_id = uuid(item.product_id, "product");
    if (seen.has(product_id)) throw new InputError("Combine duplicate products into one line.");
    seen.add(product_id);
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) {
      throw new InputError("Each quantity must be a whole number between 1 and 9,999.");
    }
    return { product_id, quantity: item.quantity };
  });
}

export function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new InputError("Choose a valid date.");
  }
  return value;
}

export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new InputError("Choose a valid offer start and end time.");
  return new Date(value).toISOString();
}

export function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 4096) throw new InputError("Use a customer password with at least 10 characters.");
  return value;
}

export function contactEmail(value: unknown): string {
  const email = text(value, "email address", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Enter a valid contact email address.");
  return email;
}
