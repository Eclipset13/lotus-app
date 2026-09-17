"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, requirePermission } from "@/lib/admin-auth";
import { hashSessionToken } from "@/lib/password";
import { manageStaff, StaffInputError, type StaffCommand } from "@/lib/staff-management";
export type StaffActionState = { error: string; message: string };
export async function saveStaff(_previous: StaffActionState, data: FormData): Promise<StaffActionState> {
  const actor = await requirePermission("staff.manage");
  try {
    const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
    const currentSessionTokenHash = token && /^[a-f0-9]{64}$/.test(token)
      ? hashSessionToken(token)
      : null;
    const result = await manageStaff(actor.userId, {
      action: String(data.get("action")) as StaffCommand["action"], userId: String(data.get("userId") ?? ""),
      name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? ""),
      roles: data.getAll("roles").map(String), password: String(data.get("password") ?? ""),
    }, { currentSessionTokenHash });
    revalidatePath("/admin/staff");
    revalidatePath("/admin/deliveries");
    return {
      error: "",
      message: result.changed
        ? result.revokedSessions > 0
          ? `Изменения сохранены. Завершено сеансов: ${result.revokedSessions}.`
          : "Изменения сохранены."
        : "Изменений нет.",
    };
  } catch (error) {
    return { error: error instanceof StaffInputError ? error.message : "Не удалось сохранить сотрудника", message: "" };
  }
}
