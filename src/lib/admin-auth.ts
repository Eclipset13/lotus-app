import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashSessionToken } from "@/lib/password";
import { hasPermission, STAFF_ROLES, type Permission } from "@/lib/permissions";

export const ADMIN_COOKIE_NAME = "lotus-admin-session";
export const SESSION_SECONDS = 12 * 60 * 60;
export const sessionCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
  path: "/", maxAge: SESSION_SECONDS,
};
export type AdminSession = { userId: string; name: string; roles: string[]; mustChangePassword: boolean };
export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await db.query<AdminSession>(`
    SELECT u.id::text AS "userId", u.name, c.must_change_password AS "mustChangePassword",
      ARRAY(SELECT r.code FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.code = ANY($2::varchar[])) AS roles
    FROM public.staff_sessions s JOIN public.users u ON u.id = s.user_id
    JOIN public.staff_credentials c ON c.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'`,
  [hashSessionToken(token), STAFF_ROLES]);
  const session = result.rows[0];
  return session?.roles.length ? session : null;
}
export async function requireAdminSession(allowPasswordChange = false) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.mustChangePassword && !allowPasswordChange) redirect("/admin/password");
  return session;
}
export async function requirePermission(permission: Permission) {
  const session = await requireAdminSession();
  if (!hasPermission(session.roles, permission)) notFound();
  return session;
}
export function checkRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
export async function authorizeApi(permission: Permission, request: Request): Promise<AdminSession | Response> {
  if (!checkRequestOrigin(request)) return Response.json({ message: "Запрос запрещён" }, { status: 403 });
  const session = await getAdminSession();
  if (!session) return Response.json({ message: "Требуется вход" }, { status: 401 });
  if (session.mustChangePassword || !hasPermission(session.roles, permission)) {
    return Response.json({ message: session.mustChangePassword ? "Сначала смените временный пароль" : "Недостаточно прав" }, { status: 403 });
  }
  return session;
}
export async function revokeCurrentSession() {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  if (!await getAdminSession()) return;
  await db.query("DELETE FROM public.staff_sessions WHERE token_hash = $1", [hashSessionToken(token)]);
}
