import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { BouquetConstructorLoader } from "@/components/bouquet-constructor-loader";
import { loadConstructorStock } from "@/lib/constructor-stock";

export const dynamic = "force-dynamic";

export default async function ConstructorPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const editCartItemId = (await searchParams).edit;
  const stock = await loadConstructorStock();

  return (
    <main className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-[#fffaf8] text-[#342622]">
      <header className="shrink-0 border-b border-[#f0dfd9] bg-white/92 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center justify-between gap-4">
          <BrandLogo />

          <Link
            href="/catalog"
            className="inline-flex min-h-11 items-center rounded-full border border-[#ead8d1] px-4 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] sm:px-5"
          >
            В каталог
          </Link>
        </div>
      </header>

      <section className="min-h-0 w-full flex-1">
        <BouquetConstructorLoader editCartItemId={editCartItemId} {...stock} />
      </section>
    </main>
  );
}
