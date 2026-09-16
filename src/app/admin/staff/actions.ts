"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { manageStaff, StaffInputError, type StaffCommand } from "@/lib/staff-management";
export type StaffActionState = { error: string; message: string };
export async function saveStaff(_previous: StaffActionState, data: FormData): Promise<StaffActionState> {
  const actor = await requirePermission("staff.manage");
  try {
    await manageStaff(actor.userId, {
      action: String(data.get("action")) as StaffCommand["action"], userId: String(data.get("userId") ?? ""),
      name: String(data.get("name") ?? ""), phone: String(data.get("phone") ?? ""),
      roles: data.getAll("roles").map(String), password: String(data.get("password") ?? ""),
    });
    revalidatePath("/admin/staff");
    revalidatePath("/admin/deliveries");
    return { error: "", message: "Изменения сохранены. Предыдущие сессии сотрудника отозваны." };
  } catch (error) {
    return { error: error instanceof StaffInputError ? error.message : "Не удалось сохранить сотрудника", message: "" };
  }
}
