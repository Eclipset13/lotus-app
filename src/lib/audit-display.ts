export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "order.status": "Статус заказа",
  "order.delivery_fee": "Стоимость доставки",
  "payment.status": "Статус оплаты",
  "delivery.assign": "Назначение доставки",
  "delivery.status": "Статус доставки",
  "flower.create": "Создание цветка",
  "flower.update": "Изменение цветка",
  "flower.activity": "Доступность цветка",
  "flower.prices": "Цены цветка",
  "flower.delete": "Удаление цветка",
  "flower.model_upload": "Загрузка 3D-модели",
  "flower.model_update": "Настройки 3D-модели",
  "flower.model_delete": "Удаление 3D-модели",
  "category.create": "Создание категории",
  "category.update": "Изменение категории",
  "category.activity": "Доступность категории",
  "category.delete": "Удаление категории",
  "bouquet.create": "Создание букета",
  "bouquet.update": "Изменение букета",
  "bouquet.activity": "Доступность букета",
  "bouquet.delete": "Удаление букета",
  "wrapping.create": "Создание упаковки",
  "wrapping.update": "Изменение упаковки",
  "wrapping.activity": "Доступность упаковки",
  "wrapping.delete": "Удаление упаковки",
  "inventory.adjust": "Корректировка остатка",
  "purchase.post": "Поступление товара",
  "staff.create": "Создание сотрудника",
  "staff.roles": "Роли сотрудника",
  "staff.disable": "Отключение сотрудника",
  "staff.enable": "Включение сотрудника",
  "staff.password_reset": "Сброс пароля сотрудника",
  "staff.sessions_revoke": "Завершение сеансов",
  "staff.password_change": "Смена собственного пароля",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  order: "Заказ",
  payment: "Оплата",
  delivery: "Доставка",
  flower: "Цветок",
  category: "Категория",
  bouquet: "Букет",
  wrapping: "Упаковка",
  inventory: "Склад",
  purchase: "Поступление",
  staff: "Сотрудник",
};

const sensitiveKey = /password|passphrase|hash|salt|token|cookie|secret|authorization|credential|\.env|env_/i;

export function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditDetails(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveKey.test(key))
        .slice(0, 100)
        .map(([key, item]) => [key, sanitizeAuditDetails(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}

export function auditEntityType(action: string) {
  return action.split(".", 1)[0] || "other";
}
