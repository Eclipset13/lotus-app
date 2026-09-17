"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { allowedSections } from "@/lib/permissions";

export function AdminNavigationLinks({ roles }: { roles: string[] }) {
  const navigation = allowedSections(roles);
  const pathname = usePathname();

  return (
    <nav className="mt-4 flex w-full max-w-full flex-nowrap gap-1 overflow-x-auto rounded-[20px] border border-[#f0dfd9] bg-white p-1.5 shadow-[0_10px_35px_rgba(74,48,41,0.05)]">
      {navigation.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-semibold transition ${
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
    </nav>
  );
}
