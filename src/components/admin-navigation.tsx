"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  {
    href: "/admin",
    label: "Заказы",
    icon: "📦",
    exact: true,
  },
  {
    href: "/admin/products",
    label: "Букеты",
    icon: "🌷",
    exact: false,
  },
  {
    href: "/admin/suppliers",
    label: "Поставщики",
    icon: "🏢",
    exact: false,
  },
];

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav className="mt-8 flex w-fit gap-1 rounded-[20px] border border-[#f0dfd9] bg-white p-1.5 shadow-[0_10px_35px_rgba(74,48,41,0.05)]">
      {navigation.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition ${
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
