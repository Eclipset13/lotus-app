"use client";

import dynamic from "next/dynamic";

const BouquetConstructor = dynamic(
  () =>
    import("@/components/bouquet-constructor").then(
      (module) => module.BouquetConstructor
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#fff4f1]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#e8c7c1] border-t-[#b85d70]" />

          <p className="mt-4 text-sm text-[#806e68]">
            Создаём 3D-букет…
          </p>
        </div>
      </div>
    ),
  }
);

export function BouquetConstructorLoader({
  editCartItemId,
}: {
  editCartItemId?: string;
}) {
  return (
    <div className="h-full min-h-0 w-full">
      <BouquetConstructor editCartItemId={editCartItemId} />
    </div>
  );
}
