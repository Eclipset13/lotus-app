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
