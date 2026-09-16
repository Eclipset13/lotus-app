import { requireAdminSession } from "@/lib/admin-auth";
import { AdminPasswordForm } from "@/components/admin-password-form";
import { BrandLogo } from "@/components/brand-logo";
import { AdminLogoutButton } from "@/components/admin-logout-button";
export default async function PasswordPage() {
  const session = await requireAdminSession(true);
  return <main className="grid min-h-screen place-items-center bg-[#fff7f4] px-5"><section className="w-full max-w-lg rounded-[36px] border border-[#f0dfd9] bg-white p-8">
    <BrandLogo /><h1 className="mt-6 font-serif text-3xl">Смена пароля</h1>
    <p className="mt-3 text-sm text-[#806e68]">{session.mustChangePassword ? "Перед началом работы смените временный пароль." : session.name}</p>
    <AdminPasswordForm />
    <AdminLogoutButton />
  </section></main>;
}
