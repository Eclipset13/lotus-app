import { db } from "@/lib/db";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return Response.json(
      { success: false, message: "Требуется вход в админ-панель" },
      { status: 401 },
    );
  }

  try {
    await db.query("SELECT 1");

    return Response.json({
      success: true,
      message: "Lotus успешно подключён к PostgreSQL",
    });
  } catch (error) {
    console.error("Ошибка PostgreSQL:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось подключиться к PostgreSQL",
      },
      { status: 500 },
    );
  }
}
