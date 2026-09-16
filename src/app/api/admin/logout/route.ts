import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, revokeCurrentSession, checkRequestOrigin } from "@/lib/admin-auth";

export const runtime = "nodejs";

const expiredCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires: new Date(0),
};

function clearSessionCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", expiredCookieOptions);
}

export async function POST(request: Request) {
  if (!checkRequestOrigin(request)) return NextResponse.json({ message: "Запрос запрещён" }, { status: 403 });
  await revokeCurrentSession();
  const response = NextResponse.redirect(
    new URL("/admin/login", request.url),
    303
  );
  clearSessionCookie(response, ADMIN_COOKIE_NAME);
  return response;
}

export async function GET() {
  return NextResponse.json({ message: "Метод не разрешён" }, {
    status: 405,
    headers: { Allow: "POST" },
  });
}