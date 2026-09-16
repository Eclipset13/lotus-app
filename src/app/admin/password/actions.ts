"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminSession, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { hashPassword, validPassword, verifyPassword } from "@/lib/password";
import { audit } from "@/lib/admin-audit";
export async function changeOwnPassword(_previous: { error: string }, data: FormData) {
  const session = await requireAdminSession(true);
  const current = data.get("currentPassword");
  const password = data.get("password");
  if (typeof current !== "string" || current.length > 128 || !validPassword(password) || password !== data.get("confirmation")) {
    return { error: "Введите текущий пароль и совпадающий новый пароль длиной 12–128 символов" };
  }
  if (current === password) return { error: "Новый пароль должен отличаться от временного или текущего" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT id FROM public.users WHERE id=$1 AND status='active' FOR UPDATE", [session.userId]);
    const credential = await client.query<{ password_hash: string }>("SELECT password_hash FROM public.staff_credentials WHERE user_id=$1", [session.userId]);
    if (!user.rows.length || !await verifyPassword(current, credential.rows[0]?.password_hash ?? null)) {
      await client.query("ROLLBACK");
      return { error: "Текущий пароль неверен" };
    }
    await client.query("UPDATE public.staff_credentials SET password_hash=$2, must_change_password=false, updated_at=NOW() WHERE user_id=$1", [session.userId, await hashPassword(password)]);
    await client.query("DELETE FROM public.staff_sessions WHERE user_id=$1", [session.userId]);
    await audit(client, session.userId, "staff.password_change", session.userId);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return { error: "Не удалось сменить пароль" };
  } finally { client.release(); }
  (await cookies()).delete(ADMIN_COOKIE_NAME);
  redirect("/admin/login?passwordChanged=1");
}
