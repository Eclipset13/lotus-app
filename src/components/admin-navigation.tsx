import { requireAdminSession } from "@/lib/admin-auth";
import { AdminNavigationLinks } from "./admin-navigation-links";
export async function AdminNavigation() {
  const session = await requireAdminSession();
  return <AdminNavigationLinks roles={session.roles} />;
}
