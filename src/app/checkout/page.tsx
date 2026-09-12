"use client";

import { normalizePhone } from "@/lib/phone";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { formatCustomBouquetComposition } from "@/lib/bouquet";
import {
  CART_STORAGE_KEY,
  getCartItemLineTotal,
  readCartState,
  type CartItem,
} from "@/lib/cart";

type CheckoutForm = {
  customerName: string;
  customerPhone: string;
  fulfillmentType: "delivery" | "pickup";
  recipientName: string;
  recipientPhone: string;
  streetAddress: string;
  apartment: string;
  entrance: string;
  floor: string;
  deliveryComment: string;
  requestedAt: string;
  paymentMethod: "cash" | "transfer";
  customerComment: string;
};

const initialForm: CheckoutForm = {
  customerName: "",
  customerPhone: "",
  fulfillmentType: "delivery",
  recipientName: "",
  recipientPhone: "",
  streetAddress: "",
  apartment: "",
  entrance: "",
  floor: "",
  deliveryComment: "",
  requestedAt: "",
  paymentMethod: "cash",
  customerComment: "",
};

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} сом`;
}

export default function CheckoutPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const [priceAdjusted, setPriceAdjusted] = useState(false);
  const [priceAdjustedOnLoad, setPriceAdjustedOnLoad] = useState(false);
  const submitPendingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      const cartState = readCartState();
      setCart(cartState.items);
      setPriceAdjustedOnLoad(cartState.priceAdjusted);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) => sum + getCartItemLineTotal(item),
        0
      ),
    [cart]
  );

  function updateField<K extends keyof CheckoutForm>(
    field: K,
    value: CheckoutForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitPendingRef.current) return;

    const customerPhone = normalizePhone(form.customerPhone);
    if (!customerPhone) {
      setError("Укажите корректный номер телефона Таджикистана: +992 и 9 цифр.");
      return;
    }

    const recipientPhone = form.recipientPhone.trim()
      ? normalizePhone(form.recipientPhone)
      : customerPhone;
    if (form.fulfillmentType === "delivery" && !recipientPhone) {
      setError("Проверьте телефон получателя");
      return;
    }

    submitPendingRef.current = true;
    setError("");
    setSubmitting(true);

    try {
      const requestedAt =
        form.fulfillmentType === "delivery" && form.requestedAt
          ? new Date(form.requestedAt).toISOString()
          : null;

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: {
            name: form.customerName,
            phone: customerPhone,
          },
          fulfillmentType: form.fulfillmentType,
          delivery:
            form.fulfillmentType === "delivery"
              ? {
                  recipientName: form.recipientName,
                  recipientPhone,
                  streetAddress: form.streetAddress,
                  apartment: form.apartment,
                  entrance: form.entrance,
                  floor: form.floor,
                  comment: form.deliveryComment,
                  requestedAt,
                }
              : undefined,
          paymentMethod: form.paymentMethod,
          customerComment: form.customerComment,
          items: cart.map((item) =>
            item.itemType === "custom-bouquet"
              ? {
                  itemType: item.itemType,
                  id: item.id,
                  quantity: item.quantity,
                  configuration: item.configuration,
                  displayedUnitPrice: item.unitPrice,
                }
              : {
                  itemType: item.itemType,
                  id: item.productId,
                  quantity: item.quantity,
                  displayedUnitPrice: item.unitPrice,
                }
          ),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Не удалось оформить заказ");
      }

      localStorage.removeItem(CART_STORAGE_KEY);
      setCart([]);
      setOrderNumber(result.orderNumber);
      setConfirmedTotal(Number(result.totalAmount));
      setPriceAdjusted(Boolean(result.priceAdjusted));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Не удалось оформить заказ"
      );
    } finally {
      submitPendingRef.current = false;
      setSubmitting(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-2xl border border-[#ead8d2] bg-white px-4 py-3.5 outline-none transition focus:border-[#b85d70] focus:ring-2 focus:ring-[#f7d9df]";

  if (!loaded) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf8]">
        <p className="text-[#806e68]">Загрузка…</p>
      </main>
    );
  }

  if (orderNumber) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf8] px-5">
        <section className="w-full max-w-xl rounded-[36px] border border-[#f0dfd9] bg-white p-10 text-center shadow-xl shadow-[#6b4030]/5">
          <div className="text-7xl">🌷</div>

          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-[#b85d70]">
            Заказ принят
          </p>

          <h1 className="mt-3 font-serif text-4xl text-[#342622]">
            Спасибо за ваш заказ
          </h1>

          <p className="mt-5 text-[#806e68]">
            Номер заказа:
          </p>

          <strong className="mt-2 block text-2xl text-[#342622]">
            {orderNumber}
          </strong>

          <p className="mt-3 text-[#806e68]">
            Сумма: {formatMoney(confirmedTotal)}
          </p>

          {priceAdjusted && (
            <p className="mt-4 rounded-2xl bg-[#fff1ed] px-4 py-3 text-sm text-[#8f554c]">
              Стоимость букета обновилась с учётом актуальных цен.
            </p>
          )}

          <p className="mt-6 leading-7 text-[#806e68]">
            Менеджер Lotus свяжется с вами для подтверждения
            заказа и уточнения доставки.
          </p>

          <Link
            href="/"
            className="mt-8 inline-block rounded-full bg-[#342622] px-8 py-4 text-white transition hover:bg-[#b85d70]"
          >
            Вернуться в каталог
          </Link>
        </section>
      </main>
    );
  }

  if (cart.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf8] px-5">
        <section className="text-center">
          <div className="text-7xl">🌸</div>

          <h1 className="mt-6 font-serif text-4xl text-[#342622]">
            Корзина пуста
          </h1>

          <p className="mt-3 text-[#806e68]">
            Добавьте хотя бы один букет.
          </p>

          <Link
            href="/#catalog"
            className="mt-7 inline-block rounded-full bg-[#342622] px-8 py-4 text-white"
          >
            Выбрать букет
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fffaf8] px-5 py-8 text-[#342622]">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex items-center justify-between">
          <BrandLogo />

          <Link
            href="/"
            className="text-sm text-[#806e68] transition hover:text-[#b85d70]"
          >
            ← Вернуться в каталог
          </Link>
        </header>

        <div className="mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b85d70]">
            Последний шаг
          </p>

          <h1 className="mt-3 font-serif text-4xl md:text-6xl">
            Оформление заказа
          </h1>
        </div>

        <form
          onSubmit={submitOrder}
          aria-busy={submitting}
          className="grid gap-8 lg:grid-cols-[1fr_390px]"
        >
          <div className="space-y-6">
            <section className="rounded-[30px] border border-[#f0dfd9] bg-white p-6 md:p-8">
              <h2 className="font-serif text-3xl">
                Ваши данные
              </h2>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <label>
                  Имя
                  <input
                    className={inputClass}
                    value={form.customerName}
                    onChange={(event) =>
                      updateField("customerName", event.target.value)
                    }
                    placeholder="Ваше имя"
                    required
                  />
                </label>

                <label>
                  Телефон
                  <input
                    className={inputClass}
                    value={form.customerPhone}
                    onChange={(event) =>
                      updateField("customerPhone", event.target.value)
                    }
                    placeholder="+992 00 000 00 00"
                    type="tel"
                    required
                  />
                </label>
              </div>
            </section>

            <section className="rounded-[30px] border border-[#f0dfd9] bg-white p-6 md:p-8">
              <h2 className="font-serif text-3xl">
                Получение
              </h2>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="cursor-pointer rounded-2xl border border-[#ead8d2] p-4">
                  <input
                    type="radio"
                    className="mr-3"
                    checked={form.fulfillmentType === "delivery"}
                    onChange={() =>
                      updateField("fulfillmentType", "delivery")
                    }
                  />
                  Доставка по Душанбе
                </label>

                <label className="cursor-pointer rounded-2xl border border-[#ead8d2] p-4">
                  <input
                    type="radio"
                    className="mr-3"
                    checked={form.fulfillmentType === "pickup"}
                    onChange={() =>
                      updateField("fulfillmentType", "pickup")
                    }
                  />
                  Самовывоз
                </label>
              </div>

              {form.fulfillmentType === "delivery" && (
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <label>
                    Имя получателя
                    <input
                      className={inputClass}
                      value={form.recipientName}
                      onChange={(event) =>
                        updateField("recipientName", event.target.value)
                      }
                      placeholder="Если отличается от заказчика"
                    />
                  </label>

                  <label>
                    Телефон получателя
                    <input
                      className={inputClass}
                      value={form.recipientPhone}
                      onChange={(event) =>
                        updateField("recipientPhone", event.target.value)
                      }
                      placeholder="Если отличается"
                      type="tel"
                    />
                  </label>

                  <label className="md:col-span-2">
                    Адрес
                    <input
                      className={inputClass}
                      value={form.streetAddress}
                      onChange={(event) =>
                        updateField("streetAddress", event.target.value)
                      }
                      placeholder="Улица и номер дома"
                      required
                    />
                  </label>

                  <label>
                    Квартира
                    <input
                      className={inputClass}
                      value={form.apartment}
                      onChange={(event) =>
                        updateField("apartment", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Подъезд
                    <input
                      className={inputClass}
                      value={form.entrance}
                      onChange={(event) =>
                        updateField("entrance", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Этаж
                    <input
                      className={inputClass}
                      value={form.floor}
                      onChange={(event) =>
                        updateField("floor", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    Желаемое время
                    <input
                      className={inputClass}
                      value={form.requestedAt}
                      onChange={(event) =>
                        updateField("requestedAt", event.target.value)
                      }
                      type="datetime-local"
                    />
                  </label>

                  <label className="md:col-span-2">
                    Комментарий курьеру
                    <textarea
                      className={inputClass}
                      value={form.deliveryComment}
                      onChange={(event) =>
                        updateField(
                          "deliveryComment",
                          event.target.value
                        )
                      }
                      placeholder="Ориентир, домофон или пожелания"
                      rows={3}
                    />
                  </label>
                </div>
              )}
            </section>

            <section className="rounded-[30px] border border-[#f0dfd9] bg-white p-6 md:p-8">
              <h2 className="font-serif text-3xl">
                Оплата
              </h2>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="cursor-pointer rounded-2xl border border-[#ead8d2] p-4">
                  <input
                    type="radio"
                    className="mr-3"
                    checked={form.paymentMethod === "cash"}
                    onChange={() =>
                      updateField("paymentMethod", "cash")
                    }
                  />
                  Наличными
                </label>

                <label className="cursor-pointer rounded-2xl border border-[#ead8d2] p-4">
                  <input
                    type="radio"
                    className="mr-3"
                    checked={form.paymentMethod === "transfer"}
                    onChange={() =>
                      updateField("paymentMethod", "transfer")
                    }
                  />
                  Переводом
                </label>
              </div>

              <label className="mt-6 block">
                Пожелания к заказу
                <textarea
                  className={inputClass}
                  value={form.customerComment}
                  onChange={(event) =>
                    updateField("customerComment", event.target.value)
                  }
                  placeholder="Текст открытки или другие пожелания"
                  rows={3}
                />
              </label>
            </section>
          </div>

          <aside className="h-fit rounded-[30px] border border-[#f0dfd9] bg-white p-6 lg:sticky lg:top-6">
            <h2 className="font-serif text-3xl">
              Ваш заказ
            </h2>

            <div className="mt-6 space-y-4">
              {cart.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[56px_minmax(0,1fr)_auto] gap-3 border-b border-[#f0dfd9] pb-4"
                >
                  <div className="relative h-14 w-14 overflow-hidden rounded-2xl bg-[#f9e2e2]">
                    {item.itemType === "custom-bouquet" && item.thumbnail ? (
                      <Image
                        src={item.thumbnail}
                        alt="Миниатюра авторского букета"
                        fill
                        unoptimized
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-2xl" aria-hidden="true">
                        {item.itemType === "custom-bouquet" ? "💐" : "🌸"}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="font-medium">{item.name}</p>

                    {item.itemType === "custom-bouquet" && (
                      <>
                        <p className="mt-1 text-xs leading-5 text-[#806e68]">
                          {formatCustomBouquetComposition(item.summary)}
                        </p>
                        <p className="text-xs text-[#99817a]">
                          Упаковка: {item.summary.wrappingName}
                        </p>
                      </>
                    )}

                    <p className="mt-1 text-sm text-[#806e68]">
                      {item.quantity} × {formatMoney(item.unitPrice)}
                    </p>
                  </div>

                  <strong className="text-right text-sm">
                    {formatMoney(getCartItemLineTotal(item))}
                  </strong>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex justify-between text-[#806e68]">
                <span>Букеты</span>
                <span>{formatMoney(subtotal)}</span>
              </div>

              <div className="flex justify-between text-[#806e68]">
                <span>Доставка</span>
                <span>Уточнит менеджер</span>
              </div>

              <div className="flex justify-between border-t border-[#f0dfd9] pt-4 text-xl">
                <strong>Итого</strong>
                <strong>{formatMoney(subtotal)}</strong>
              </div>
            </div>

            {priceAdjustedOnLoad && (
              <p className="mt-5 rounded-2xl bg-[#fff1ed] px-4 py-3 text-sm text-[#8f554c]">
                Стоимость букета обновилась с учётом актуальных цен.
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <span className="sr-only" aria-live="polite">
              {submitting ? "Оформляем заказ" : ""}
            </span>

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-full bg-[#342622] px-6 py-4 text-white transition hover:bg-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Оформляем заказ…"
                : "Подтвердить заказ"}
            </button>

            <p className="mt-4 text-center text-xs leading-5 text-[#99817a]">
              Менеджер свяжется с вами для подтверждения.
            </p>
          </aside>
        </form>
      </div>
    </main>
  );
}
