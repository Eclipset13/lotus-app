import Link from "next/link";
import { requireAdminSession } from "@/lib/admin-auth";
import { AdminNavigationLinks } from "./admin-navigation-links";
import { AdminLogoutButton } from "./admin-logout-button";
export async function AdminNavigation() {
  const session = await requireAdminSession();
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Link href="/" className="rounded-full border border-[#ead8d2] bg-white px-5 py-3 text-sm">
          Открыть магазин
        </Link>
        <Link href="/admin/password" className="rounded-full border border-[#ead8d2] bg-white px-5 py-3 text-sm">
          Пароль
        </Link>
        <AdminLogoutButton className="rounded-full bg-[#342622] text-white hover:bg-[#b85d70]" />
      </div>
      <AdminNavigationLinks roles={session.roles} />
    </>
  );
}
