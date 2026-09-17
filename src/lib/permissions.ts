export const STAFF_ROLES = ["super_admin", "florist", "inventory_manager", "courier"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: "Супер-администратор", florist: "Флорист",
  inventory_manager: "Менеджер склада", courier: "Курьер",
};
export type Permission = "orders.read" | "orders.work" | "orders.manage" | "payments.manage"
  | "products.manage" | "customers.read" | "inventory.read" | "inventory.manage"
  | "prices.manage" | "suppliers.manage" | "purchases.manage" | "models.manage"
  | "deliveries.read" | "deliveries.manage" | "staff.manage" | "settings.manage";
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  super_admin: ["orders.read", "orders.work", "orders.manage", "payments.manage", "products.manage",
    "customers.read", "inventory.read", "inventory.manage", "prices.manage", "suppliers.manage",
    "purchases.manage", "models.manage", "deliveries.read", "deliveries.manage", "staff.manage", "settings.manage"],
  florist: ["orders.read", "orders.work", "payments.manage", "products.manage", "customers.read", "inventory.read"],
  inventory_manager: ["inventory.read", "inventory.manage", "prices.manage", "suppliers.manage", "purchases.manage", "models.manage"],
  courier: ["deliveries.read"],
};
export function hasPermission(roles: readonly string[], permission: Permission) {
  return roles.some((role) => (ROLE_PERMISSIONS[role as StaffRole] ?? []).includes(permission));
}
export const ADMIN_SECTIONS: { href: string; label: string; icon: string; permission: Permission; exact: boolean }[] = [
  { href: "/admin", label: "Заказы", icon: "📦", permission: "orders.read", exact: true },
  { href: "/admin/products", label: "Букеты", icon: "🌷", permission: "products.manage", exact: false },
  { href: "/admin/deliveries", label: "Доставка", icon: "📍", permission: "deliveries.read", exact: false },
  { href: "/admin/customers", label: "Покупатели", icon: "👥", permission: "customers.read", exact: false },
  { href: "/admin/suppliers", label: "Поставщики", icon: "🏢", permission: "suppliers.manage", exact: false },
  { href: "/admin/purchases", label: "Поступления", icon: "🚚", permission: "purchases.manage", exact: false },
  { href: "/admin/inventory", label: "Склад", icon: "🌿", permission: "inventory.read", exact: false },
  { href: "/admin/staff", label: "Сотрудники", icon: "👤", permission: "staff.manage", exact: false },
  { href: "/admin/audit", label: "Журнал", icon: "🧾", permission: "settings.manage", exact: false },
];
export function allowedSections(roles: readonly string[]) {
  return ADMIN_SECTIONS.filter((item) => hasPermission(roles, item.permission));
}
export function staffHome(roles: readonly string[]) {
  return allowedSections(roles)[0]?.href ?? "/admin/login";
}
export function canWorkOrder(roles: readonly string[], current: string, next: string) {
  if (hasPermission(roles, "orders.manage")) return true;
  return hasPermission(roles, "orders.work") && ["new", "confirmed", "preparing"].includes(current)
    && ["confirmed", "preparing", "ready", "cancelled"].includes(next);
}
