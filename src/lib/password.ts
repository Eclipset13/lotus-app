import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

// Node crypto.scrypt: unique 16-byte salt; fixed parameters also bound verification cost.
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const prefix = "scrypt$131072$8$1";
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, "hex"), 64, options,
    (error, key) => error ? reject(error) : resolve(key)));
}
export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export async function hashPassword(password: string) {
  if (!validPassword(password)) throw new Error("Пароль должен содержать от 12 до 128 символов");
  const salt = randomBytes(16).toString("hex");
  return `${prefix}$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const match = encoded?.match(/^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  // Unknown users still perform the same expensive operation.
  const key = await derive(password, match?.[1] ?? "0".repeat(32));
  const expected = Buffer.from(match?.[2] ?? "0".repeat(128), "hex");
  return timingSafeEqual(key, expected) && Boolean(match);
}
export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function newSessionToken() { return randomBytes(32).toString("hex"); }
