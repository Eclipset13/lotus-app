"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { SupplierActionState } from "@/app/admin/suppliers/actions";

export type SupplierFormValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  bankDetails: string;
  contractDetails: string;
  notes: string;
  isActive: boolean;
};

type SupplierFormAction = (
  state: SupplierActionState,
  formData: FormData,
) => Promise<SupplierActionState>;

type AdminSupplierFormProps = {
  action: SupplierFormAction;
  submitLabel: string;
  values?: SupplierFormValues;
};

const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25";
const textareaClass =
  "mt-2 w-full resize-y rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 text-sm leading-6 outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25";
const labelClass =
  "block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]";
const initialSupplierActionState: SupplierActionState = {
  error: "",
  message: "",
};

export function AdminSupplierForm({
  action,
  submitLabel,
  values,
}: AdminSupplierFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialSupplierActionState,
  );

  return (
    <form
      action={formAction}
      className="mt-8 overflow-hidden rounded-[32px] border border-[#f0dfd9] bg-white shadow-[0_20px_60px_rgba(74,48,41,0.06)]"
    >
      <div className="grid gap-8 p-6 md:p-8 lg:grid-cols-2">
        <section className="space-y-6">
          <label className={labelClass} htmlFor="supplier-name">
            Название организации
            <input
              id="supplier-name"
              name="name"
              type="text"
              required
              maxLength={200}
              defaultValue={values?.name}
              placeholder="Например: Цветочная база Восток"
              className={inputClass}
            />
          </label>

          <label className={labelClass} htmlFor="supplier-contact-name">
            Контактное лицо
            <input
              id="supplier-contact-name"
              name="contact_name"
              type="text"
              maxLength={200}
              defaultValue={values?.contactName}
              placeholder="Имя представителя"
              className={inputClass}
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={labelClass} htmlFor="supplier-phone">
              Телефон
              <input
                id="supplier-phone"
                name="phone"
                type="tel"
                maxLength={64}
                defaultValue={values?.phone}
                placeholder="+992 00 000 00 00"
                className={inputClass}
              />
            </label>

            <label className={labelClass} htmlFor="supplier-email">
              Электронная почта
              <input
                id="supplier-email"
                name="email"
                type="email"
                maxLength={254}
                defaultValue={values?.email}
                placeholder="supplier@example.com"
                className={inputClass}
              />
            </label>
          </div>

          <label className={labelClass} htmlFor="supplier-address">
            Адрес
            <textarea
              id="supplier-address"
              name="address"
              rows={3}
              maxLength={2_000}
              defaultValue={values?.address}
              placeholder="Город, улица, склад или офис"
              className={textareaClass}
            />
          </label>

          <label className={labelClass} htmlFor="supplier-tax-id">
            ИНН
            <input
              id="supplier-tax-id"
              name="tax_id"
              type="text"
              maxLength={64}
              defaultValue={values?.taxId}
              placeholder="Идентификационный номер"
              className={inputClass}
            />
          </label>
        </section>

        <section className="space-y-6">
          <label className={labelClass} htmlFor="supplier-bank-details">
            Банковские реквизиты
            <textarea
              id="supplier-bank-details"
              name="bank_details"
              rows={5}
              maxLength={4_000}
              defaultValue={values?.bankDetails}
              placeholder="Банк, счёт и другие реквизиты"
              className={textareaClass}
            />
          </label>

          <label className={labelClass} htmlFor="supplier-contract-details">
            Договор
            <textarea
              id="supplier-contract-details"
              name="contract_details"
              rows={4}
              maxLength={4_000}
              defaultValue={values?.contractDetails}
              placeholder="Номер, дата и основные условия"
              className={textareaClass}
            />
          </label>

          <label className={labelClass} htmlFor="supplier-notes">
            Примечание
            <textarea
              id="supplier-notes"
              name="notes"
              rows={4}
              maxLength={4_000}
              defaultValue={values?.notes}
              placeholder="Дополнительная информация"
              className={textareaClass}
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#ead8d1] bg-[#fffaf8] p-4">
            <span>
              <span className="block text-sm font-semibold">
                Активный поставщик
              </span>
              <span className="mt-1 block text-xs text-[#99817a]">
                Доступен для дальнейших складских операций
              </span>
            </span>

            <input
              type="checkbox"
              name="is_active"
              defaultChecked={values?.isActive ?? true}
              className="peer sr-only"
            />
            <span className="relative h-7 w-12 shrink-0 rounded-full bg-[#dccbc6] transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#b85d70] peer-checked:bg-[#c97d72] after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-5" />
          </label>
        </section>
      </div>

      {state.error && (
        <p
          role="alert"
          className="mx-6 mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:mx-8"
        >
          {state.error}
        </p>
      )}

      <footer className="flex flex-col-reverse gap-3 border-t border-[#f3e6e1] bg-[#fffaf8] px-6 py-5 sm:flex-row sm:justify-end md:px-8">
        <Link
          href="/admin/suppliers"
          className="flex h-12 items-center justify-center rounded-2xl border border-[#ead8d1] px-6 text-sm font-semibold text-[#806e68] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
        >
          Отмена
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-2xl bg-[#c97d72] px-7 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:-translate-y-0.5 hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Сохраняем…" : submitLabel}
        </button>
      </footer>
    </form>
  );
}
