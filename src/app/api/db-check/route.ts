import { db } from "@/lib/db";
import { authorizeApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await authorizeApi("settings.manage", request);
  if (session instanceof Response) return session;

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
