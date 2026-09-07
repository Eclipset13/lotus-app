import { redirect } from "next/navigation";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminSupplierForm } from "@/components/admin-supplier-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupplier } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">
            Новый поставщик
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">
            Добавьте контакты, реквизиты и сведения о договоре.
          </p>
          <AdminNavigation />
        </header>
        <AdminSupplierForm
          action={createSupplier}
          submitLabel="Сохранить поставщика"
        />
      </div>
    </main>
  );
}
