import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { BrandLogo } from "@/components/brand-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
};

function formatMoney(value: string) {
  return (
    new Intl.NumberFormat("ru-RU").format(Number(value)) +
    " сомони"
  );
}

export default async function CatalogPage() {
  const result = await db.query<Product>(`
    SELECT
      id::text,
      name,
      description,
      price::text,
      image_url
    FROM products
    WHERE is_active = TRUE
    ORDER BY created_at DESC
  `);

  const products = result.rows;

  return (
    <main className="min-h-screen bg-[#fffaf8] text-[#342622]">
      <header className="border-b border-[#f0dfd9] bg-white/90 px-5 py-5 backdrop-blur md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <BrandLogo />

          <Link
            href="/"
            className="rounded-full border border-[#ead8d1] px-5 py-2.5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]"
          >
            На главную
          </Link>
        </div>
      </header>

      <section className="px-5 pb-10 pt-14 text-center md:px-10 md:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#b07b72]">
          Коллекция Lotus
        </p>

        <h1 className="mx-auto mt-4 max-w-3xl font-serif text-4xl leading-tight md:text-6xl">
          Букеты для особенных моментов
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-[#806e68] md:text-base">
          Нежные композиции из свежих цветов, созданные с
          вниманием к каждой детали.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 md:px-10">
        {products.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-[#e5cbc3] bg-white px-6 py-20 text-center">
            <span className="text-5xl">🌷</span>

            <h2 className="mt-5 font-serif text-3xl">
              Новая коллекция уже готовится
            </h2>

            <p className="mt-3 text-sm text-[#806e68]">
              Скоро здесь появятся наши букеты.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <article
                key={product.id}
                className="group overflow-hidden rounded-[30px] border border-[#f0dfd9] bg-white shadow-[0_12px_40px_rgba(74,48,41,0.05)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_60px_rgba(74,48,41,0.11)]"
              >
                <div className="aspect-[4/5] overflow-hidden bg-[#f8ece8]">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      width={800}
                      height={1000}
                      unoptimized
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-7xl">🌸</span>
                    </div>
                  )}
                </div>

                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="font-serif text-2xl leading-tight">
                      {product.name}
                    </h2>

                    <strong className="shrink-0 text-sm text-[#b66f65]">
                      {formatMoney(product.price)}
                    </strong>
                  </div>

                  <p className="mt-3 line-clamp-2 min-h-11 text-sm leading-6 text-[#806e68]">
                    {product.description ||
                      "Нежный букет из свежих цветов."}
                  </p>

                  <Link
                    href={`/catalog/${product.id}`}
                    className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-[#342622] text-sm font-semibold text-white transition hover:bg-[#c97d72]"
                  >
                    Посмотреть букет
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
