"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { allowedSections } from "@/lib/permissions";
import { AdminLogoutButton } from "./admin-logout-button";

export function AdminNavigationLinks({ roles }: { roles: string[] }) {
  const navigation = allowedSections(roles);
  const pathname = usePathname();

  return (
    <nav className="mt-8 flex w-full max-w-full flex-wrap gap-1 rounded-[20px] border border-[#f0dfd9] bg-white p-1.5 shadow-[0_10px_35px_rgba(74,48,41,0.05)]">
      {navigation.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
              isActive
                ? "bg-[#342622] text-white shadow-sm"
                : "text-[#806e68] hover:bg-[#fff4f1] hover:text-[#4d3934]"
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
      <Link href="/admin/password" className="rounded-2xl px-5 py-3 text-sm text-[#806e68]">Пароль</Link>
      <AdminLogoutButton />
    </nav>
  );
}
