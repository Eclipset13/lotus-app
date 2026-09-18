"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { BouquetImage } from "@/components/bouquet-image";
import { formatCustomBouquetComposition } from "@/lib/bouquet";
import type { PublicBouquet } from "@/lib/public-bouquets";
import {
  CART_ITEM_MAX_QUANTITY,
  addCatalogBouquetToCart,
  getCartItemLineTotal,
  readCartState,
  writeCartItems,
  type CartItem,
} from "@/lib/cart";

export default function Storefront({
  bouquets,
}: {
  bouquets: PublicBouquet[];
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartDrawerRef = useRef<HTMLElement>(null);
  const cartCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      const cartState = readCartState();
      const activeBouquetIds = new Set(bouquets.map((bouquet) => bouquet.id));
      const reconciled = cartState.items.map((item) => item.itemType === "catalog-bouquet" && !activeBouquetIds.has(item.productId)
        ? { ...item, unavailable: true as const }
        : item);
      setCart(reconciled);
      setCartLoaded(true);

      if (cartState.priceAdjusted) {
        setCartNotice("Стоимость букета обновилась с учётом актуальных цен.");
      }

      const url = new URL(window.location.href);
      const notice = url.searchParams.get("notice");

      if (url.searchParams.get("cart") === "open") {
        setCartOpen(true);
      }

      if (notice === "updated") {
        setCartNotice("Изменения сохранены");
      } else if (notice === "added") {
        setCartNotice("Букет добавлен в корзину");
      }

      if (url.searchParams.get("preview") === "missing") {
        setCartNotice((current) =>
          `${current || "Букет сохранён"}. Миниатюру создать не удалось.`
        );
      }

      if (url.searchParams.has("cart") || url.searchParams.has("notice")) {
        url.searchParams.delete("cart");
        url.searchParams.delete("notice");
        url.searchParams.delete("preview");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bouquets]);

  useEffect(() => {
    if (cartLoaded) {
      writeCartItems(cart);
    }
  }, [cart, cartLoaded]);

  useEffect(() => {
    if (!cartNotice) return;
    const timeout = window.setTimeout(() => setCartNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [cartNotice]);

  useEffect(() => {
    if (!cartOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = cartButtonRef.current;
    const focusFrame = window.requestAnimationFrame(() =>
      cartCloseRef.current?.focus()
    );
    document.body.style.overflow = "hidden";

    const handleCartKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCartOpen(false);
        return;
      }

      if (event.key !== "Tab" || !cartDrawerRef.current) return;

      const focusable = Array.from(
        cartDrawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleCartKeys);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleCartKeys);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [cartOpen]);

  const totalQuantity = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const totalPrice = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + getCartItemLineTotal(item),
        0
      ),
    [cart]
  );

  function addToCart(bouquet: PublicBouquet) {
    setCart((currentCart) => addCatalogBouquetToCart(currentCart, bouquet));

    setCartOpen(true);
  }

  function changeQuantity(id: string, amount: number) {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.id === id
          ? {
              ...item,
              quantity: Math.min(
                CART_ITEM_MAX_QUANTITY,
                Math.max(1, item.quantity + amount)
              ),
            }
          : item
      )
    );
  }

  function removeItem(id: string) {
    setCart((currentCart) =>
      currentCart.filter((item) => item.id !== id)
    );
  }

  return (
    <main>
      {cartNotice && (
        <div className="cartToast" role="status" aria-live="polite">
          {cartNotice}
        </div>
      )}

      <header className="header">
        <BrandLogo />

        <nav>
          <Link className="constructorNavLink" href="/catalog">
            Каталог
          </Link>
          <Link className="constructorNavLink" href="/constructor">
            Собрать букет
          </Link>
          <a className="constructorNavLink" href="#about">О нас</a>
          <a className="constructorNavLink" href="#delivery">Доставка</a>
        </nav>

        <button
          ref={cartButtonRef}
          type="button"
          className="cartButton"
          onClick={() => setCartOpen(true)}
          aria-expanded={cartOpen}
        >
          Корзина · {totalQuantity}
        </button>
      </header>

      <section className="hero">
        <div className="heroContent">
          <p className="eyebrow">Цветочная студия в Душанбе</p>

          <h1>
            Цветы, которые
            <span> говорят за вас</span>
          </h1>

          <p className="heroText">
            Нежные авторские букеты из свежих цветов с доставкой
            по Душанбе.
          </p>

          <div className="heroActions">
            <a className="primaryButton" href="#catalog">
              Выбрать букет
            </a>
            <Link className="secondaryButton" href="/constructor">
              Собрать свой букет
            </Link>
          </div>
        </div>

        <div className="heroVisual">
          <Image
            className="heroBouquet"
            src="/images/lotus-hero-bouquet.png"
            alt="Нежный букет Lotus из роз и тюльпанов"
            width={1312}
            height={1199}
            priority
          />
          <p>Собрано с любовью</p>
        </div>
      </section>

      <section className="catalog" id="catalog">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Коллекция Lotus</p>
            <h2>Популярные букеты</h2>
          </div>

          <p>{bouquets.length} букетов в каталоге</p>
        </div>

        <div className="bouquetGrid">
          {bouquets.map((bouquet, index) => (
            <article className="bouquetCard" key={bouquet.id}>
              <div
                className={`bouquetImage bouquetImage${(index % 3) + 1} overflow-hidden`}
              >
                <BouquetImage src={bouquet.image_url} name={bouquet.name} />

                {bouquet.is_featured && (
                  <div className="badge">Популярное</div>
                )}
              </div>

              <div className="bouquetInfo">
                <h3>{bouquet.name}</h3>
                <p>{bouquet.description}</p>

                <div className="bouquetBottom">
                  <strong>
                    {Number(bouquet.sale_price).toLocaleString(
                      "ru-RU"
                    )}{" "}
                    сом
                  </strong>

                  <button
                    type="button"
                    disabled={!cartLoaded}
                    onClick={() => addToCart(bouquet)}
                    aria-label={`Добавить ${bouquet.name} в корзину`}
                  >
                    +
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="about" id="about">
        <div className="aboutIntro">
          <p className="eyebrow">О студии Lotus</p>
          <h2>Цветы, собранные с вниманием</h2>
          <p>
            Lotus — цветочная студия в Душанбе, где можно выбрать готовый букет
            или собрать собственную композицию из доступных цветов.
          </p>
          <Link className="primaryButton" href="/constructor">
            Собрать букет
          </Link>
        </div>
        <div className="aboutAdvantages">
          {[
            ["Свежие цветы", "Подбираем цветы для аккуратных и выразительных композиций."],
            ["Индивидуальный подход", "Учитываем повод, настроение и пожелания к букету."],
            ["Собственный букет", "В конструкторе можно выбрать цветы и собрать композицию самостоятельно."],
          ].map(([title, text], index) => (
            <article key={title}>
              <span aria-hidden="true">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {cartOpen && (
        <>
          <button
            type="button"
            className="cartOverlay"
            onClick={() => setCartOpen(false)}
            aria-label="Закрыть корзину"
          />

          <aside
            ref={cartDrawerRef}
            className="cartDrawer"
            role="dialog"
            aria-modal="true"
            aria-label="Корзина"
          >
            <div className="cartHeader">
              <div>
                <p className="eyebrow">Ваш заказ</p>
                <h2>Корзина</h2>
              </div>

              <button
                ref={cartCloseRef}
                type="button"
                className="cartClose"
                onClick={() => setCartOpen(false)}
                aria-label="Закрыть корзину"
              >
                ×
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="emptyCart">
                <span>🌷</span>
                <h3>Корзина пока пуста</h3>
                <p>Добавьте букет из коллекции Lotus.</p>

                <button type="button" onClick={() => setCartOpen(false)}>
                  Выбрать букет
                </button>
              </div>
            ) : (
              <>
                <div className="cartItems">
                  {cart.map((item) => (
                    <article className="cartItem" key={item.id}>
                      <div className="cartItemImage">
                        {item.itemType === "custom-bouquet" && item.thumbnail ? (
                          <Image
                            src={item.thumbnail}
                            alt="Миниатюра авторского букета"
                            width={86}
                            height={86}
                            unoptimized
                          />
                        ) : (
                          <span aria-hidden="true">
                            {item.itemType === "custom-bouquet" ? "💐" : "🌸"}
                          </span>
                        )}
                      </div>

                      <div className="cartItemContent">
                        <div className="cartItemTop">
                          <h3>{item.name}</h3>

                          <button
                            type="button"
                            className="removeButton"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Удалить ${item.name}`}
                          >
                            ×
                          </button>
                        </div>

                        {item.itemType === "custom-bouquet" ? (
                          <div className="customBouquetDetails">
                            <p>{formatCustomBouquetComposition(item.summary)}</p>
                            {item.configuration.flowers.some((flower) => !flower.kind && !flower.snapshot?.model) && <p>3D-модель этого цветка пока не добавлена. Расположение доступно в редакторе на карте.</p>}
                            <p>Упаковка: {item.summary.wrappingName}</p>
                            <p>{item.unitPrice.toLocaleString("ru-RU")} сом за букет</p>
                            <Link
                              href={`/constructor?edit=${encodeURIComponent(item.id)}`}
                              className="editBouquetButton"
                            >
                              Редактировать
                            </Link>
                          </div>
                        ) : (
                          item.unavailable ? <p className="text-sm font-semibold text-red-700">Позиция больше недоступна. Удалите её из корзины.</p> : <p>{item.unitPrice.toLocaleString("ru-RU")} сом</p>
                        )}

                        <div className="quantityControl">
                          <button
                            type="button"
                            onClick={() =>
                              changeQuantity(item.id, -1)
                            }
                            aria-label="Уменьшить количество"
                            disabled={item.quantity <= 1 || (item.itemType === "catalog-bouquet" && item.unavailable)}
                          >
                            −
                          </button>

                          <span>{item.quantity}</span>

                          <button
                            type="button"
                            onClick={() =>
                              changeQuantity(item.id, 1)
                            }
                            aria-label="Увеличить количество"
                            disabled={
                              item.quantity >= CART_ITEM_MAX_QUANTITY || (item.itemType === "catalog-bouquet" && item.unavailable)
                            }
                          >
                            +
                          </button>
                        </div>

                        <strong className="cartLineTotal">
                          {getCartItemLineTotal(item).toLocaleString("ru-RU")} сом
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="cartFooter">
                  <div className="cartTotal">
                    <span>Итого</span>
                    <strong>
                      {totalPrice.toLocaleString("ru-RU")} сом
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="checkoutButton"
                    disabled={cart.some((item) => item.itemType === "catalog-bouquet" && item.unavailable)}
                    onClick={() => window.location.assign("/checkout")}
                  >
                    {cart.some((item) => item.itemType === "catalog-bouquet" && item.unavailable) ? "Удалите недоступную позицию" : "Перейти к оформлению"}
                  </button>

                  <p>Доставка рассчитывается при оформлении</p>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </main>
  );
}
