/** Canonical E.164 Tajikistan number, or null for invalid/unsupported numbers. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!/^\+?[0-9\s()-]+$/.test(input)) return null;
  const digits = input.replace(/[+\s()-]/g, "");
  if (input.startsWith("+") && (digits.length !== 12 || !digits.startsWith("992"))) {
    return null;
  }
  const national = digits.length === 9
    ? digits
    : digits.length === 12 && digits.startsWith("992")
      ? digits.slice(3)
      : null;
  // Exactly nine national digits, including leading zeros; reject placeholders.
  if (!national || !/^[0-9]{9}$/.test(national) || /^([0-9])\1{8}$/.test(national)) {
    return null;
  }
  return `+992${national}`;
}
