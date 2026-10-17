const ACCESS_KEY = /^[a-z0-9][a-z0-9_-]{3,39}$/;
const CUSTOMER_DOMAIN = "customers.grandsave.invalid";

export function normalizeAccessKey(value: string): string | null {
  const key = value.trim().toLowerCase();
  return ACCESS_KEY.test(key) ? key : null;
}

export function accessKeyEmail(key: string): string {
  const normalized = normalizeAccessKey(key);
  if (!normalized) throw new Error("Access keys must contain 4–40 letters, numbers, underscores or hyphens and start with a letter or number.");
  return `${normalized}@${CUSTOMER_DOMAIN}`;
}
