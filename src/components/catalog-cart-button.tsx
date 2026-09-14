"use client";

import { useState } from "react";
import { addCatalogBouquetToCart, readCartItems, writeCartItems } from "@/lib/cart";

export function CatalogCartButton({ bouquet }: {
  bouquet: { id: string; name: string; sale_price: string };
}) {
  const [notice, setNotice] = useState("");

  function addToCart() {
    try {
      const items = addCatalogBouquetToCart(readCartItems(), bouquet);
      writeCartItems(items);
      const quantity = items.find(
        (item) => item.itemType === "catalog-bouquet" && item.productId === bouquet.id,
      )?.quantity;
      setNotice(`В корзине: ${quantity} шт.`);
    } catch {
      setNotice("Не удалось сохранить корзину. Попробуйте ещё раз.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={addToCart}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-[#342622] text-sm font-semibold text-white transition hover:bg-[#c97d72]"
        aria-label={`Добавить ${bouquet.name} в корзину`}
      >
        В корзину
      </button>
      <p role="status" className="mt-2 min-h-5 text-center text-xs text-[#806e68]">
        {notice}
      </p>
    </>
  );
}
