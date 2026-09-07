"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export type SupplierActionState = {
  error: string;
  message: string;
};

type SupplierInput = {
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readText(formData: FormData, field: string) {
  return String(formData.get(field) ?? "").trim();
}

function readSupplierInput(formData: FormData):
  | { input: SupplierInput; error: "" }
  | { input: null; error: string } {
  const input: SupplierInput = {
    name: readText(formData, "name"),
    contactName: readText(formData, "contact_name"),
    phone: readText(formData, "phone"),
    email: readText(formData, "email"),
    address: readText(formData, "address"),
    taxId: readText(formData, "tax_id"),
    bankDetails: readText(formData, "bank_details"),
    contractDetails: readText(formData, "contract_details"),
    notes: readText(formData, "notes"),
    isActive: formData.get("is_active") === "on",
  };

  if (!input.name) {
    return { input: null, error: "Введите название организации" };
  }

  if (input.email && !EMAIL_PATTERN.test(input.email)) {
    return { input: null, error: "Проверьте электронную почту" };
  }

  const limits: Array<[string, number, string]> = [
    [input.name, 200, "название организации"],
    [input.contactName, 200, "контактное лицо"],
    [input.phone, 64, "телефон"],
    [input.email, 254, "электронную почту"],
    [input.address, 2_000, "адрес"],
    [input.taxId, 64, "ИНН"],
    [input.bankDetails, 4_000, "банковские реквизиты"],
    [input.contractDetails, 4_000, "договор"],
    [input.notes, 4_000, "примечание"],
  ];

  const tooLong = limits.find(([value, maximum]) => value.length > maximum);

  if (tooLong) {
    return {
      input: null,
      error: `Сократите поле «${tooLong[2]}»`,
    };
  }

  return { input, error: "" };
}

function isSupplierId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value)) {
    return false;
  }

  const maximumBigint = "9223372036854775807";
  return value.length < maximumBigint.length || value <= maximumBigint;
}

function nullable(value: string) {
  return value || null;
}

export async function createSupplier(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const parsed = readSupplierInput(formData);
  if (!parsed.input) {
    return { error: parsed.error, message: "" };
  }

  const input = parsed.input;

  try {
    await db.query(
      `
        INSERT INTO public.suppliers (
          name,
          contact_name,
          phone,
          email,
          address,
          notes,
          is_active,
          tax_id,
          bank_details,
          contract_details,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `,
      [
        input.name,
        nullable(input.contactName),
        nullable(input.phone),
        nullable(input.email),
        nullable(input.address),
        nullable(input.notes),
        input.isActive,
        nullable(input.taxId),
        nullable(input.bankDetails),
        nullable(input.contractDetails),
      ],
    );
  } catch (error) {
    console.error("createSupplier failed:", error);
    return { error: "Не удалось сохранить поставщика", message: "" };
  }

  revalidatePath("/admin/suppliers");
  redirect("/admin/suppliers");
}

export async function updateSupplier(
  supplierId: string,
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  if (!isSupplierId(supplierId)) {
    return { error: "Поставщик не найден", message: "" };
  }

  const parsed = readSupplierInput(formData);
  if (!parsed.input) {
    return { error: parsed.error, message: "" };
  }

  const input = parsed.input;

  try {
    const result = await db.query(
      `
        UPDATE public.suppliers
        SET name = $1,
            contact_name = $2,
            phone = $3,
            email = $4,
            address = $5,
            notes = $6,
            is_active = $7,
            tax_id = $8,
            bank_details = $9,
            contract_details = $10,
            updated_at = NOW()
        WHERE id = $11::bigint
        RETURNING id
      `,
      [
        input.name,
        nullable(input.contactName),
        nullable(input.phone),
        nullable(input.email),
        nullable(input.address),
        nullable(input.notes),
        input.isActive,
        nullable(input.taxId),
        nullable(input.bankDetails),
        nullable(input.contractDetails),
        supplierId,
      ],
    );

    if (result.rowCount === 0) {
      return { error: "Поставщик не найден", message: "" };
    }
  } catch (error) {
    console.error("updateSupplier failed:", error);
    return { error: "Не удалось сохранить поставщика", message: "" };
  }

  revalidatePath("/admin/suppliers");
  redirect("/admin/suppliers");
}

export async function toggleSupplierStatus(
  supplierId: string,
  _previousState: SupplierActionState,
  _formData: FormData,
): Promise<SupplierActionState> {
  void _previousState;
  void _formData;

  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  if (!isSupplierId(supplierId)) {
    return { error: "Поставщик не найден", message: "" };
  }

  try {
    const result = await db.query(
      `
        UPDATE public.suppliers
        SET is_active = NOT is_active,
            updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING is_active
      `,
      [supplierId],
    );

    if (result.rowCount === 0) {
      return { error: "Поставщик не найден", message: "" };
    }
  } catch (error) {
    console.error("toggleSupplierStatus failed:", error);
    return {
      error: "Не удалось изменить статус поставщика",
      message: "",
    };
  }

  revalidatePath("/admin/suppliers");
  return { error: "", message: "Статус поставщика обновлён" };
}
