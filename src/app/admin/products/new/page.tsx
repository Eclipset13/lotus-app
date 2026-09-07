import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNavigation } from "@/components/admin-navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createProduct } from "../actions";
import { BrandLogo } from "@/components/brand-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
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
            Новый букет
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#806e68]">
            Добавьте информацию о букете, цену и фотографию.
          </p>

          <AdminNavigation />
        </header>

        <form
          action={createProduct}
          className="mt-8 overflow-hidden rounded-[32px] border border-[#f0dfd9] bg-white shadow-[0_20px_60px_rgba(74,48,41,0.06)]"
        >
          <div className="grid gap-8 p-6 md:p-8 lg:grid-cols-2">
            <section className="space-y-6">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]"
                >
                  Название букета
                </label>

                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Например: Нежный рассвет"
                  className="h-13 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 text-sm outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]"
                >
                  Описание
                </label>

                <textarea
                  id="description"
                  name="description"
                  rows={6}
                  placeholder="Расскажите, из каких цветов состоит букет..."
                  className="w-full resize-none rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 text-sm leading-6 outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
                />
              </div>
            </section>

            <section className="space-y-6">
              <div>
                <label
                  htmlFor="price"
                  className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]"
                >
                  Цена
                </label>

                <div className="relative">
                  <input
                    id="price"
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="350"
                    className="h-13 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 pr-24 text-sm outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#99817a]">
                    сомони
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="image_url"
                  className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]"
                >
                  Ссылка на фотографию
                </label>

                <input
                  id="image_url"
                  name="image_url"
                  type="url"
                  placeholder="https://..."
                  className="h-13 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 text-sm outline-none transition placeholder:text-[#b9a5a0] focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
                />

                <p className="mt-2 text-xs leading-5 text-[#a18d87]">
                  Пока используем ссылку. Позже добавим загрузку фотографии
                  прямо с компьютера.
                </p>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#ead8d1] bg-[#fffaf8] p-4">
                <div>
                  <span className="block text-sm font-semibold">
                    Показывать в каталоге
                  </span>

                  <span className="mt-1 block text-xs text-[#99817a]">
                    Покупатели сразу увидят этот букет
                  </span>
                </div>

                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked
                  className="peer sr-only"
                />

                <span className="relative h-7 w-12 shrink-0 rounded-full bg-[#dccbc6] transition peer-checked:bg-[#c97d72] after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-5" />
              </label>
            </section>
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-[#f3e6e1] bg-[#fffaf8] px-6 py-5 sm:flex-row sm:justify-end md:px-8">
            <Link
              href="/admin/products"
              className="flex h-12 items-center justify-center rounded-2xl border border-[#ead8d1] px-6 text-sm font-semibold text-[#806e68] transition hover:bg-white"
            >
              Отмена
            </Link>

            <button
              type="submit"
              className="h-12 rounded-2xl bg-[#c97d72] px-7 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:-translate-y-0.5 hover:bg-[#b96e64]"
            >
              Сохранить букет
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}
