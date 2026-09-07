import { db } from "@/lib/db";

export async function GET() {
  try {
    const result = await db.query(`
      SELECT
        current_database() AS database,
        current_user AS user_name,
        (SELECT COUNT(*) FROM flowers) AS flowers_count,
        (SELECT COUNT(*) FROM bouquets) AS bouquets_count,
        (SELECT COUNT(*) FROM orders) AS orders_count
    `);

    return Response.json({
      success: true,
      message: "Lotus успешно подключён к PostgreSQL",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Ошибка PostgreSQL:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось подключиться к PostgreSQL",
      },
      { status: 500 }
    );
  }
}