import { redirect } from "next/navigation";
import Image from "next/image";
import { AdminNavigation } from "@/components/admin-navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { toggleProductVisibility } from "./actions";
import { BrandLogo } from "@/components/brand-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Product = {
    id: string;
    name: string;
    description: string | null;
    price: string;
    image_url: string | null;
    is_active: boolean;
};

function formatMoney(value: string) {
    return new Intl.NumberFormat("ru-RU").format(Number(value)) + " сомони";
}

export default async function AdminProductsPage() {
    if (!(await isAdminAuthenticated())) {
        redirect("/admin/login");
    }

    const result = await db.query<Product>(`
    SELECT
      id::text,
      name,
      description,
      price::text,
      image_url,
      is_active
    FROM products
    ORDER BY created_at DESC
  `);

    const products = result.rows;

    const activeProducts = products.filter(
        (product) => product.is_active
    ).length;

    return (
        <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
            <div className="mx-auto max-w-7xl">
                <header>
                    <BrandLogo />

                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
                        Панель управления
                    </p>

                    <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h1 className="font-serif text-4xl md:text-5xl">
                                Ассортимент
                            </h1>

                            <p className="mt-3 max-w-xl text-sm leading-6 text-[#806e68]">
                                Управление букетами, ценами и отображением товаров
                                в каталоге.
                            </p>
                        </div>

                        <Link
                            href="/admin/products/new"
                            className="w-fit rounded-2xl bg-[#c97d72] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:-translate-y-0.5 hover:bg-[#b96e64]"
                        >
                            + Добавить букет
                        </Link>
                    </div>

                    <AdminNavigation />
                </header>

                <section className="mt-8 grid gap-4 sm:grid-cols-3">
                    <article className="rounded-[24px] border border-[#f0dfd9] bg-white p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                            Всего букетов
                        </p>

                        <strong className="mt-4 block font-serif text-4xl">
                            {products.length}
                        </strong>
                    </article>

                    <article className="rounded-[24px] border border-[#f0dfd9] bg-white p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                            В продаже
                        </p>

                        <strong className="mt-4 block font-serif text-4xl text-green-700">
                            {activeProducts}
                        </strong>
                    </article>

                    <article className="rounded-[24px] border border-[#f0dfd9] bg-white p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                            Скрыто
                        </p>

                        <strong className="mt-4 block font-serif text-4xl text-[#b07b72]">
                            {products.length - activeProducts}
                        </strong>
                    </article>
                </section>

                {products.length === 0 ? (
                    <section className="mt-8 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
                        <span className="text-4xl">🌷</span>

                        <h2 className="mt-4 font-serif text-2xl">
                            Букетов пока нет
                        </h2>

                        <p className="mt-2 text-sm text-[#806e68]">
                            Добавьте первый букет в каталог Lotus.
                        </p>
                    </section>
                ) : (
                    <section className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {products.map((product) => (
                            <article
                                key={product.id}
                                className="group overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(74,48,41,0.09)]"
                            >
                                <div className="relative aspect-[4/3] overflow-hidden bg-[#f9eeea]">
                                    {product.image_url ? (
                                        <Image
                                            src={product.image_url}
                                            alt={product.name}
                                            width={800}
                                            height={600}
                                            unoptimized
                                            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-5xl">
                                            🌸
                                        </div>
                                    )}

                                    <span
                                        className={`absolute left-4 top-4 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ${product.is_active
                                            ? "bg-green-50 text-green-700"
                                            : "bg-white text-[#9a746c]"
                                            }`}
                                    >
                                        {product.is_active ? "В продаже" : "Скрыт"}
                                    </span>
                                </div>

                                <div className="p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <h2 className="font-serif text-2xl">
                                            {product.name}
                                        </h2>

                                        <strong className="shrink-0 text-sm text-[#b66f65]">
                                            {formatMoney(product.price)}
                                        </strong>
                                    </div>

                                    <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-[#806e68]">
                                        {product.description || "Описание пока не добавлено"}
                                    </p>

                                    <div className="mt-5 flex gap-2 border-t border-[#f3e6e1] pt-4">
                                        <Link
                                            href={`/admin/products/${product.id}/edit`}
                                            className="flex flex-1 items-center justify-center rounded-xl bg-[#342622] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b3731]"
                                        >
                                            Редактировать
                                        </Link>

                                        <form action={toggleProductVisibility.bind(null, product.id)}>
                                            <button
                                                type="submit"
                                                className="h-full rounded-xl border border-[#ead8d1] px-4 py-2.5 text-sm font-medium text-[#806e68] transition hover:bg-[#fff4f1]"
                                            >
                                                {product.is_active ? "Скрыть" : "Показать"}
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </section>
                )}
            </div>
        </main>
    );
}
