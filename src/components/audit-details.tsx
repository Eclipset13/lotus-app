import { sanitizeAuditDetails } from "@/lib/audit-display";

const keyLabels: Record<string, string> = {
  before: "Было",
  after: "Стало",
  fields: "Поля",
  active: "Активно",
  order_id: "ID заказа",
  payment_id: "ID оплаты",
  staff_id: "ID сотрудника",
  courier_user_id: "ID курьера",
  revoked_sessions: "Завершено сеансов",
  preserved_current_session: "Текущий сеанс сохранён",
  old_delivery_fee: "Прежняя доставка",
  new_delivery_fee: "Новая доставка",
  subtotal: "Товары",
  old_total: "Прежний итог",
  new_total: "Новый итог",
  old_payment_amount: "Прежняя сумма оплаты",
  new_payment_amount: "Новая сумма оплаты",
};

function scalar(value: unknown) {
  if (value === null) return "—";
  if (value === true) return "Да";
  if (value === false) return "Нет";
  return String(value);
}

function DetailValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return <span>{value.map(scalar).join(", ") || "—"}</span>;
    }
    return <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (value && typeof value === "object") {
    return <AuditDetailList details={value as Record<string, unknown>} nested />;
  }
  return <span className="break-words">{scalar(value)}</span>;
}

function AuditDetailList({ details, nested = false }: { details: Record<string, unknown>; nested?: boolean }) {
  const entries = Object.entries(details);
  if (entries.length === 0) return <span className="text-[#9a8882]">Без дополнительных деталей</span>;
  return (
    <dl className={nested ? "mt-1 space-y-1 border-l border-[#ead8d1] pl-3" : "space-y-1"}>
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-1 sm:grid-cols-[minmax(120px,0.35fr)_1fr]">
          <dt className="font-medium text-[#806e68]">{keyLabels[key] || key.replaceAll("_", " ")}</dt>
          <dd><DetailValue value={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditDetails({ details }: { details: unknown }) {
  const safe = sanitizeAuditDetails(details);
  return safe && typeof safe === "object" && !Array.isArray(safe)
    ? <AuditDetailList details={safe as Record<string, unknown>} />
    : <DetailValue value={safe} />;
}
