# Миграции PostgreSQL

## Авторские букеты в заказах

Файл миграции: `20260905_custom_bouquets.sql`.

Текущая прикладная роль `lotus_app` не является владельцем таблицы
`public.order_items`, поэтому выполнить `ALTER TABLE` из приложения нельзя.
Миграцию нужно запустить в pgAdmin под владельцем таблицы (`postgres`).

1. Откройте pgAdmin и подключитесь к тому же серверу и базе данных, которые
   указаны в `PGHOST` и `PGDATABASE` проекта.
2. Выберите базу данных и откройте **Tools → Query Tool**.
3. Нажмите **Open File**, выберите
   `src/db/migrations/20260905_custom_bouquets.sql`.
4. Убедитесь, что в правом верхнем углу Query Tool подключение выполнено под
   ролью `postgres` или другим владельцем `public.order_items`.
5. Нажмите **Execute Script** (`F5`). Скрипт выполняется внутри транзакции и
   завершится строкой `COMMIT`.
6. Выполните запрос проверки:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'order_items'
  AND column_name IN ('custom_configuration', 'custom_summary')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.order_items'::regclass
  AND conname IN ('order_items_type_check', 'order_items_product_check')
ORDER BY conname;
```

Первый запрос должен вернуть две колонки типа `jsonb`. Во втором результате
`order_items_type_check` должен содержать `custom_bouquet`, а
`order_items_product_check` — разрешать авторскую позицию с пустыми
`flower_id`/`bouquet_id` и заполненными JSONB-полями.

Миграция не удаляет старые строки, не меняет внешние ключи каталожных товаров
и допускает повторный запуск.

## Дополнительные данные поставщиков

Файл миграции: `20260907_suppliers_details.sql`.

Откройте базу `lotus_db` в pgAdmin под владельцем таблицы (`postgres`),
выберите **Tools → Query Tool**, откройте файл
`src/db/migrations/20260907_suppliers_details.sql` и выполните его клавишей
`F5`. Миграция идемпотентно добавляет только `tax_id`, `bank_details` и
`contract_details`; существующие данные, ограничения и внешние ключи не
изменяются.

## Закупки и поступления цветов

Файл миграции: `20260907_purchases.sql`.

Перед запуском убедитесь, что подключение открыто к базе `lotus_db` под
владельцем таблиц `postgres`. В pgAdmin выберите **Tools → Query Tool**,
откройте `src/db/migrations/20260907_purchases.sql` и выполните весь файл
клавишей `F5`.

Эквивалентная команда из PowerShell при доступном `psql`:

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260907_purchases.sql"
```

Миграция создаёт документы `purchases`, их позиции `purchase_items` и связь
`stock_movements.purchase_id`. Повторный запуск безопасен. Существующие типы
складских движений не изменяются; текущая база уже допускает тип `purchase`.
