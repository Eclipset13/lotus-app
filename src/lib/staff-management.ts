import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { hashPassword, validPassword } from "@/lib/password";
import { audit } from "@/lib/admin-audit";

export class StaffInputError extends Error {}
export type StaffCommand = {
  action: "create" | "roles" | "disable" | "enable" | "password_reset" | "sessions_revoke";
  userId?: string; name?: string; phone?: string; roles?: string[]; password?: string;
};
export type StaffMutationResult = { changed: boolean; revokedSessions: number };
export type StaffMutationContext = { currentSessionTokenHash?: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function protectLastSuperAdmin(client: PoolClient, userId: string) {
  const result = await client.query<{ protected: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id
      JOIN public.roles r ON r.id=ur.role_id JOIN public.staff_credentials c ON c.user_id=u.id
      WHERE u.id=$1 AND u.status='active' AND r.code='super_admin')
    AND (SELECT count(*) FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id
      JOIN public.roles r ON r.id=ur.role_id JOIN public.staff_credentials c ON c.user_id=u.id
      WHERE u.status='active' AND r.code='super_admin') = 1 AS protected`, [userId]);
  if (result.rows[0]?.protected) throw new StaffInputError("Нельзя отключить или снять роль последнего активного супер-администратора");
}
export async function manageStaff(
  actorId: string,
  command: StaffCommand,
  context: StaffMutationContext = {},
): Promise<StaffMutationResult> {
  const roles = [...new Set(command.roles ?? [])].sort();
  if (!["create", "roles", "disable", "enable", "password_reset", "sessions_revoke"].includes(command.action)) throw new StaffInputError("Недопустимое действие");
  if (["create", "roles"].includes(command.action) && (!roles.length || roles.some((role) => !STAFF_ROLES.includes(role as StaffRole)))) {
    throw new StaffInputError("Выберите хотя бы одну роль сотрудника");
  }
  const needsPassword = ["create", "password_reset"].includes(command.action);
  if (needsPassword && !validPassword(command.password)) throw new StaffInputError("Пароль должен содержать от 12 до 128 символов");
  const name = command.name?.trim();
  const phone = normalizePhone(command.phone);
  if (command.action === "create" && (!name || name.length > 120 || !phone)) throw new StaffInputError("Проверьте имя и телефон сотрудника");
  if (command.action !== "create" && !uuid.test(command.userId ?? "")) throw new StaffInputError("Сотрудник не найден");
  const passwordHash = needsPassword ? await hashPassword(command.password!) : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize all role/status changes, including concurrent attempts to remove two admins.
    await client.query("SELECT pg_advisory_xact_lock(726016, 1)");
    const actor = await client.query(`SELECT u.id FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id
      JOIN public.roles r ON r.id=ur.role_id JOIN public.staff_credentials c ON c.user_id=u.id
      WHERE u.id=$1 AND u.status='active' AND r.code='super_admin'`, [actorId]);
    if (!actor.rows.length) throw new StaffInputError("Недостаточно прав");
    let userId = command.userId!;
    let currentStatus = "active";
    let previousRoles: string[] = [];
    if (command.action === "create") {
      const existing = await client.query<{ id: string }>("SELECT id::text FROM public.users WHERE phone=$1 FOR UPDATE", [phone]);
      if (existing.rows.length) throw new StaffInputError("Этот телефон уже занят. Для существующего сотрудника используйте его карточку.");
      userId = (await client.query<{ id: string }>("INSERT INTO public.users (name, phone) VALUES ($1, $2) RETURNING id::text", [name, phone])).rows[0].id;
    } else {
      const user = await client.query<{ id: string; status: string }>("SELECT id::text, status FROM public.users WHERE id=$1 FOR UPDATE", [userId]);
      const employee = await client.query<{ code: string }>(`SELECT r.code FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
        WHERE ur.user_id=$1 AND r.code = ANY($2::varchar[])`, [userId, STAFF_ROLES]);
      if (!user.rows.length || !employee.rows.length) throw new StaffInputError("Сотрудник не найден");
      currentStatus = user.rows[0].status;
      previousRoles = employee.rows.map((row) => row.code).sort();
    }

    if (command.action === "roles" && previousRoles.join("\0") === roles.join("\0")) {
      await client.query("COMMIT");
      return { changed: false, revokedSessions: 0 };
    }
    if (command.action === "disable" && currentStatus !== "active") {
      await client.query("COMMIT");
      return { changed: false, revokedSessions: 0 };
    }
    if (command.action === "enable" && currentStatus === "active") {
      await client.query("COMMIT");
      return { changed: false, revokedSessions: 0 };
    }
    if (command.action === "disable" || (command.action === "roles" && previousRoles.includes("super_admin") && !roles.includes("super_admin"))) {
      await protectLastSuperAdmin(client, userId);
    }

    let revokedSessions = 0;
    if (["create", "roles"].includes(command.action)) {
      await client.query(`DELETE FROM public.user_roles WHERE user_id=$1 AND role_id IN
        (SELECT id FROM public.roles WHERE code=ANY($2::varchar[]))`, [userId, STAFF_ROLES]);
      await client.query(`INSERT INTO public.user_roles (user_id, role_id, granted_by)
        SELECT $1::uuid, id, $3::uuid FROM public.roles WHERE code=ANY($2::varchar[]) ON CONFLICT DO NOTHING`, [userId, roles, actorId]);
    }
    if (passwordHash) {
      await client.query(`INSERT INTO public.staff_credentials (user_id,password_hash,must_change_password)
        VALUES ($1,$2,true) ON CONFLICT (user_id) DO UPDATE SET password_hash=$2, must_change_password=true, updated_at=NOW()`, [userId, passwordHash]);
    }
    if (["disable", "enable"].includes(command.action)) {
      await client.query("UPDATE public.users SET status=$2, updated_at=NOW() WHERE id=$1", [userId, command.action === "disable" ? "blocked" : "active"]);
    }

    if (command.action === "sessions_revoke") {
      const preserveHash = actorId === userId ? context.currentSessionTokenHash ?? null : null;
      const revoked = await client.query(`DELETE FROM public.staff_sessions
        WHERE user_id=$1 AND expires_at > NOW()
          AND ($2::text IS NULL OR token_hash<>$2)
        RETURNING token_hash`, [userId, preserveHash]);
      revokedSessions = revoked.rowCount ?? 0;
      if (revokedSessions === 0) {
        await client.query("COMMIT");
        return { changed: false, revokedSessions: 0 };
      }
      await audit(client, actorId, "staff.sessions_revoke", userId, {
        revoked_sessions: revokedSessions,
        preserved_current_session: Boolean(preserveHash),
      });
    } else if (command.action !== "create") {
      // Changed roles, disabled access and password resets invalidate old authorization.
      if (["roles", "disable", "password_reset"].includes(command.action)) {
        const revoked = await client.query("DELETE FROM public.staff_sessions WHERE user_id=$1 RETURNING token_hash", [userId]);
        revokedSessions = revoked.rowCount ?? 0;
      }
      const details = command.action === "roles"
        ? { before: previousRoles, after: roles, revoked_sessions: revokedSessions }
        : command.action === "disable" || command.action === "enable"
          ? { before: currentStatus, after: command.action === "disable" ? "blocked" : "active", revoked_sessions: revokedSessions }
          : { revoked_sessions: revokedSessions };
      await audit(client, actorId, `staff.${command.action}`, userId, details);
    } else {
      await audit(client, actorId, "staff.create", userId, {
        roles,
        status: "active",
        has_personal_password: true,
      });
    }
    await client.query("COMMIT");
    return { changed: true, revokedSessions };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new StaffInputError("Этот телефон уже занят");
    throw error;
  } finally { client.release(); }
}
