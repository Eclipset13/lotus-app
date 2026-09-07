import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNavigation } from "@/components/admin-navigation";
import {
  AdminSupplierForm,
  type SupplierFormValues,
} from "@/components/admin-supplier-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { updateSupplier } from "../../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  tax_id: string | null;
  bank_details: string | null;
  contract_details: string | null;
};

function isSupplierId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value)) {
    return false;
  }

  const maximumBigint = "9223372036854775807";
  return value.length < maximumBigint.length || value <= maximumBigint;
}

function MissingSupplier() {
  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <BrandLogo />
        <AdminNavigation />
        <section className="mt-8 rounded-[28px] border border-[#f0dfd9] bg-white px-6 py-16 text-center">
          <h1 className="font-serif text-4xl">Поставщик не найден</h1>
          <p className="mt-3 text-sm text-[#806e68]">
            Проверьте адрес страницы или вернитесь к списку.
          </p>
          <Link
            href="/admin/suppliers"
            className="mt-7 inline-flex h-12 items-center rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white"
          >
            К поставщикам
          </Link>
        </section>
      </div>
    </main>
  );
}

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const { id } = await params;
  if (!isSupplierId(id)) {
    return <MissingSupplier />;
  }

  const result = await db.query<Supplier>(
    `
      SELECT id::text,
             name,
             contact_name,
             phone,
             email,
             address,
             notes,
             is_active,
             tax_id,
             bank_details,
             contract_details
      FROM public.suppliers
      WHERE id = $1::bigint
      LIMIT 1
    `,
    [id],
  );

  const supplier = result.rows[0];
  if (!supplier) {
    return <MissingSupplier />;
  }

  const values: SupplierFormValues = {
    name: supplier.name,
    contactName: supplier.contact_name ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    taxId: supplier.tax_id ?? "",
    bankDetails: supplier.bank_details ?? "",
    contractDetails: supplier.contract_details ?? "",
    notes: supplier.notes ?? "",
    isActive: supplier.is_active,
  };
  const updateCurrentSupplier = updateSupplier.bind(null, supplier.id);

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">
            Редактирование поставщика
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">
            Обновите контакты, реквизиты, договор или статус.
          </p>
          <AdminNavigation />
        </header>
        <AdminSupplierForm
          action={updateCurrentSupplier}
          submitLabel="Сохранить изменения"
          values={values}
        />
      </div>
    </main>
  );
}
