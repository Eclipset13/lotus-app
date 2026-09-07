import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "lotus-admin-session";

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  const currentToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const expectedToken = process.env.ADMIN_SESSION_TOKEN;

  return Boolean(
    currentToken &&
      expectedToken &&
      currentToken === expectedToken
  );
}