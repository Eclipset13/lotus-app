import "server-only";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { hashSessionToken, newSessionToken, verifyPassword } from "@/lib/password";
import { STAFF_ROLES, staffHome } from "@/lib/permissions";

// Database buckets work across processes. No spoofable forwarded IP headers are trusted.
async function isLimited(bucket: string, maximum: number) {
  const result = await db.query<{ limited: boolean }>(`
    SELECT COALESCE((SELECT attempts >= $2 AND expires_at > NOW()
      FROM public.staff_login_limits WHERE bucket_hash = $1), false) AS limited`,
  [hashSessionToken(bucket), maximum]);
  return result.rows[0]?.limited ?? false;
}
async function recordFailure(bucket: string) {
  const result = await db.query(`INSERT INTO public.staff_login_limits (bucket_hash, attempts, expires_at)
    VALUES ($1, 1, NOW() + interval '15 minutes')
    ON CONFLICT (bucket_hash) DO UPDATE SET
      attempts = CASE WHEN staff_login_limits.expires_at <= NOW() THEN 1 ELSE staff_login_limits.attempts + 1 END,
      expires_at = CASE WHEN staff_login_limits.expires_at <= NOW() THEN NOW() + interval '15 minutes' ELSE staff_login_limits.expires_at END
    RETURNING attempts`, [hashSessionToken(bucket)]);
  return result.rowCount === 1;
}
export async function loginStaff(phoneValue: unknown, password: unknown) {
  const phone = normalizePhone(phoneValue);
  const rawIdentity = typeof phoneValue === "string" ? phoneValue.trim().slice(0, 64) : "invalid";
  const identityBucket = `staff-login:${phone ?? rawIdentity}`;
  await db.query("DELETE FROM public.staff_login_limits WHERE expires_at <= NOW()");
  if (await isLimited("staff-login:global", 200) || await isLimited(identityBucket, 5)) {
    return { status: 429 as const };
  }
  if (!phone || typeof password !== "string" || password.length > 128 || !password.length) {
    await Promise.all([recordFailure("staff-login:global"), recordFailure(identityBucket)]);
    return { status: 401 as const };
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Same user lock as staff management/reset: a racing login cannot survive revocation.
    const users = await client.query<{ id: string; status: string }>(
      "SELECT id::text, status FROM public.users WHERE phone = $1 FOR UPDATE", [phone]);
    const user = users.rows[0];
    const credentials = user ? await client.query<{ password_hash: string; must_change_password: boolean }>(
      "SELECT password_hash, must_change_password FROM public.staff_credentials WHERE user_id = $1", [user.id]) : null;
    const credential = credentials?.rows[0];
    const valid = await verifyPassword(password, credential?.password_hash ?? null);
    const roles = user ? (await client.query<{ code: string }>(`SELECT r.code FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.code = ANY($2::varchar[])`,
    [user.id, STAFF_ROLES])).rows.map((row) => row.code) : [];
    if (!valid || user?.status !== "active" || !roles.length) {
      await client.query("ROLLBACK");
      await Promise.all([recordFailure("staff-login:global"), recordFailure(identityBucket)]);
      return { status: 401 as const };
    }
    const token = newSessionToken();
    await client.query("DELETE FROM public.staff_sessions WHERE expires_at <= NOW()");
    await client.query(`INSERT INTO public.staff_sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2::uuid, NOW() + interval '12 hours')`, [hashSessionToken(token), user.id]);
    await client.query("UPDATE public.users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    await client.query("DELETE FROM public.staff_login_limits WHERE bucket_hash = $1", [hashSessionToken(identityBucket)]);
    await client.query("COMMIT");
    return { status: 200 as const, token, redirectTo: credential?.must_change_password ? "/admin/password" : staffHome(roles) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
