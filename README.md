This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## 3D-модели складских цветов

Перед первым сохранением модели примените под владельцем таблицы миграцию
[`20260914_flower_models.sql`](src/db/migrations/20260914_flower_models.sql),
см. [инструкцию](src/db/migrations/README.md). Приложение не применяет её автоматически.
Без миграции конструктор продолжает работать без назначенных моделей.

В админке откройте **Склад → карточка цветка → 3D-модель**. Выберите `.glb`
до 20 МиБ со встроенными PNG/JPEG, настройте размер, поворот и смещение стебля,
нажмите «Сохранить модель». Изменения до сохранения локальны для предпросмотра.
Поддерживаются статичные треугольные модели без внешних ресурсов, Draco,
Meshopt, KTX2, скелетной анимации и разреженных данных; максимум 500 000 треугольников.
Модели автоматически вписываются по габаритам; точку крепления стебля нужно
уточнить вручную. Модели без назначенного файла доступны через схему и список.

Файлы хранятся в `var/flower-models` относительно корня запуска приложения,
вне `.next`, `public` и исходников. Каталог исключён из Git, процессу Node
нужны права записи. Запускайте приложение из одного постоянного каталога.
Сохраняйте резервную копию этого каталога **вместе с PostgreSQL**.
Файлы выдаются по сгенерированному UUID через `/api/flower-models/[assetId]`.
Замена создаёт новый файл. Снятие привязки и изменение настроек не меняют
визуальные снимки оформленных заказов. Старые файлы намеренно не удаляются;
не очищайте каталог вручную. Незавершённые файлы `.tmp` после аварийного
завершения процесса можно удалить при остановленном приложении.

Для будущего хостинга потребуется постоянный диск (общий для экземпляров
приложения) или объектное хранилище. Эфемерный диск serverless не подходит.
Облачное хранилище сейчас не подключено.

## Фотографии букетов и цветов

Загруженные из административных форм PNG, JPEG и WebP хранятся в
`var/product-images` относительно корня запуска приложения. Максимальный размер —
10 МиБ; SVG и файлы с несовпадающей сигнатурой отклоняются. Процессу Node нужны
права на создание каталога, запись временных файлов и атомарное переименование.
Файлы выдаются только по UUID через `/api/product-images/[assetId]`.

При замене или снятии привязки старый файл намеренно не удаляется: он может
оставаться в кеше или использоваться историческим снимком. Резервируйте
`var/product-images` вместе с PostgreSQL и `var/flower-models`. Для нескольких
экземпляров приложения нужен общий постоянный диск либо объектное хранилище;
эфемерный serverless-диск не подходит, поскольку файлы исчезнут после перезапуска.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
