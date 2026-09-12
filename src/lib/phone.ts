/** Canonical E.164 Tajikistan number, or null for invalid/unsupported numbers. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9]/g, "");
  const national = digits.length === 9
    ? digits
    : digits.length === 12 && digits.startsWith("992")
      ? digits.slice(3)
      : null;
  // No trunk prefix, empty subscriber number or obvious repeated-digit placeholder.
  if (!national || !/^[1-9][0-9]{8}$/.test(national) || /^([0-9])\1{8}$/.test(national)) {
    return null;
  }
  return `+992${national}`;
}
