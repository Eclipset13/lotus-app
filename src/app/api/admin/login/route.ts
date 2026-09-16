import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, sessionCookieOptions, checkRequestOrigin } from "@/lib/admin-auth";
import { loginStaff } from "@/lib/staff-login";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!checkRequestOrigin(request)) return NextResponse.json({ message: "Запрос запрещён" }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "Некорректный запрос" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Некорректный запрос" }, { status: 400 });
  try {
    const result = await loginStaff(body.phone, body.password);
    if (result.status !== 200) return NextResponse.json({ message: result.status === 429
      ? "Слишком много попыток. Попробуйте через 15 минут." : "Неверный телефон или пароль" },
    { status: result.status, headers: result.status === 429 ? { "Retry-After": "900" } : {} });
    const response = NextResponse.json({ success: true, redirectTo: result.redirectTo });
    response.cookies.set(ADMIN_COOKIE_NAME, result.token, sessionCookieOptions);
    return response;
  } catch {
    return NextResponse.json({ message: "Вход временно недоступен. Обратитесь к владельцу магазина." }, { status: 503 });
  }
}
