/** Canonical numeric(12,2) decimal text; no binary floating point or silent rounding. */
export function parsePrice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}
