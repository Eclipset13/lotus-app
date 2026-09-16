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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function protectLastSuperAdmin(client: PoolClient, userId: string) {
  const result = await client.query<{ protected: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id
      JOIN public.roles r ON r.id=ur.role_id WHERE u.id=$1 AND u.status='active' AND r.code='super_admin')
    AND NOT EXISTS (SELECT 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id
      JOIN public.roles r ON r.id=ur.role_id JOIN public.staff_credentials c ON c.user_id=u.id
      WHERE u.id<>$1 AND u.status='active' AND r.code='super_admin') AS protected`, [userId]);
  if (result.rows[0]?.protected) throw new StaffInputError("Нельзя отключить или снять роль последнего активного супер-администратора");
}
export async function manageStaff(actorId: string, command: StaffCommand) {
  const roles = [...new Set(command.roles ?? [])];
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
      JOIN public.roles r ON r.id=ur.role_id WHERE u.id=$1 AND u.status='active' AND r.code='super_admin'`, [actorId]);
    if (!actor.rows.length) throw new StaffInputError("Недостаточно прав");
    let userId = command.userId!;
    if (command.action === "create") {
      const existing = await client.query<{ id: string }>("SELECT id::text FROM public.users WHERE phone=$1 FOR UPDATE", [phone]);
      if (existing.rows.length) throw new StaffInputError("Этот телефон уже занят. Для существующего сотрудника используйте его карточку.");
      userId = (await client.query<{ id: string }>("INSERT INTO public.users (name, phone) VALUES ($1, $2) RETURNING id::text", [name, phone])).rows[0].id;
    } else {
      const user = await client.query("SELECT id FROM public.users WHERE id=$1 FOR UPDATE", [userId]);
      const employee = await client.query(`SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
        WHERE ur.user_id=$1 AND r.code = ANY($2::varchar[])`, [userId, STAFF_ROLES]);
      if (!user.rows.length || !employee.rows.length) throw new StaffInputError("Сотрудник не найден");
    }
    if (command.action === "disable" || (command.action === "roles" && !roles.includes("super_admin"))) {
      await protectLastSuperAdmin(client, userId);
    }
    if (["create", "roles"].includes(command.action)) {
      const previous = await client.query<{ code: string }>(`SELECT r.code FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=$1`, [userId]);
      await client.query(`DELETE FROM public.user_roles WHERE user_id=$1 AND role_id IN
        (SELECT id FROM public.roles WHERE code=ANY($2::varchar[]))`, [userId, STAFF_ROLES]);
      await client.query(`INSERT INTO public.user_roles (user_id, role_id, granted_by)
        SELECT $1::uuid, id, $3::uuid FROM public.roles WHERE code=ANY($2::varchar[]) ON CONFLICT DO NOTHING`, [userId, roles, actorId]);
      await audit(client, actorId, "staff.roles", userId, { before: previous.rows.map((r) => r.code), after: roles });
    }
    if (passwordHash) {
      await client.query(`INSERT INTO public.staff_credentials (user_id,password_hash,must_change_password)
        VALUES ($1,$2,true) ON CONFLICT (user_id) DO UPDATE SET password_hash=$2, must_change_password=true, updated_at=NOW()`, [userId, passwordHash]);
    }
    if (["disable", "enable"].includes(command.action)) {
      await client.query("UPDATE public.users SET status=$2, updated_at=NOW() WHERE id=$1", [userId, command.action === "disable" ? "blocked" : "active"]);
    }
    // Revocation also applies to changed roles, to discard permissions in already open browsers.
    await client.query("DELETE FROM public.staff_sessions WHERE user_id=$1", [userId]);
    await audit(client, actorId, `staff.${command.action}`, userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new StaffInputError("Этот телефон уже занят");
    throw error;
  } finally { client.release(); }
}
