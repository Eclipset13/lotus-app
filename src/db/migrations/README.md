# Миграции PostgreSQL

## Упаковки конструктора

Файл: `20260917_constructor_wrappings.sql`. Выполните вручную под владельцем
схемы после резервной копии; приложение миграцию не запускает:

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260917_constructor_wrappings.sql"
```

Если прикладная роль называется не `lotus_app`, перед запуском в том же
соединении задайте `SET lotus.app_role = 'имя_роли';`. Миграция создаёт единый
справочник и добавляет `blush`, `kraft`, `ivory`, не перезаписывая строки при
повторном запуске.

```sql
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'constructor_wrappings'
ORDER BY ordinal_position;

SELECT slug, name, sale_price, opacity, sort_order, is_active
FROM public.constructor_wrappings
ORDER BY sort_order, id;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.constructor_wrappings'::regclass
ORDER BY conname;
```

## 3D-модели цветов

Файл: `20260914_flower_models.sql`. Миграция подготовлена, автоматически не применяется.
В pgAdmin подключитесь к базе проекта под владельцем `public.flowers`
(обычно `postgres`), откройте **Tools → Query Tool**, выберите файл и выполните
его целиком (`F5`). Скрипт идемпотентен: добавляет только nullable JSONB
`flowers.model_3d` и проверку типа объекта. Складские данные и заказы не меняет.
Прикладной роли достаточно существующих прав SELECT/UPDATE на таблицу;
не выдавайте ей права владельца ради этой миграции.

Проверка после применения:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'flowers' AND column_name = 'model_3d';
```

Затем откройте карточку складского цветка и раздел «3D-модель».
До применения сохранение модели вернёт понятное сообщение о миграции;
чтение существующих букетов продолжит работать. Файлы `var/flower-models`
нужно сохранять вместе с резервными копиями БД. Удаление или замена привязки
не удаляет файл: на него могут ссылаться JSON-снимки старых заказов.

## Канонические телефоны покупателей

Телефоны сохраняются в формате `+992XXXXXXXXX`, совместимом с существующими
`users_phone_e164_check` и `UNIQUE (phone)`. Новая миграция не нужна;
ошибочная `20260912_users_canonical_phone.sql` удалена без применения.
Описание реализации и проверок: [customer-phone.md](customer-phone.md).

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

## Связь цветов со складским составом 3D-конструктора

Файл миграции: `20260908_flower_constructor_kind.sql`.

В pgAdmin откройте базу `lotus_db` под владельцем таблицы (`postgres`), затем
**Tools → Query Tool**, откройте файл
`D:\Projects\lotus-app\src\db\migrations\20260908_flower_constructor_kind.sql`
и выполните его клавишей `F5`.

Эквивалентная команда PowerShell при доступном `psql`:

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260908_flower_constructor_kind.sql"
```

Миграция идемпотентно добавляет nullable-поле `flowers.constructor_kind`,
ограничивает значения ключами `rose`, `peony`, `tulip` и гарантирует, что
каждый ключ связан не более чем с одним складским цветком. Существующие цветы
автоматически не сопоставляются и не изменяются.

Проверка после применения:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'flowers'
  AND column_name = 'constructor_kind';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.flowers'::regclass
  AND conname = 'flowers_constructor_kind_check';
```

## Резервирование цветов по заказам

Файл миграции: `20260908_order_stock_reservations.sql`.

В pgAdmin откройте базу `lotus_db` под владельцем таблиц (`postgres`), затем
**Tools → Query Tool**, откройте файл
`D:\Projects\lotus-app\src\db\migrations\20260908_order_stock_reservations.sql`
и выполните его клавишей `F5`.

Эквивалентная команда PowerShell при доступном `psql`:

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260908_order_stock_reservations.sql"
```

Миграция создаёт таблицу `order_stock_reservations`, добавляет связь
`stock_movements.reservation_id` и уникальную защиту от повторного списания
одного резерва. Существующий триггер складских остатков не изменяется.

## Права прикладной роли на складские документы

Файл миграции: `20260909_app_privileges.sql`.

После миграций поступлений и резервов выполните этот файл в базе `lotus_db`
под владельцем объектов (`postgres`). Он выдаёт роли `lotus_app` права на
таблицы `purchases`, `purchase_items`, `order_stock_reservations` и их
последовательности. Если роль отсутствует, миграция завершится без ошибки и
выведет уведомление.

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260909_app_privileges.sql"
```

## Снимок состава готового букета в заказе

Файл миграции: `20260910_order_item_bouquet_snapshot.sql`.

Выполните файл в базе `lotus_db` через pgAdmin (**Tools → Query Tool**) под владельцем
таблицы `public.order_items` (`postgres`). Миграция идемпотентно добавляет nullable-колонку
`bouquet_composition_snapshot JSONB` и один раз заполняет её для старых позиций готовых
букетов, у которых сейчас настроен корректный состав. Уже сохранённые снимки не
перезаписываются, а позиции без состава остаются без снимка.

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260910_order_item_bouquet_snapshot.sql"
```

## Административное управление доставками

Файл миграции: `20260911_deliveries_admin.sql`.

Выполните файл в базе `lotus_db` через pgAdmin (**Tools → Query Tool**) под владельцем
таблицы `public.deliveries` (`postgres`). Миграция идемпотентно добавляет плановое время
`scheduled_at`, внутреннее примечание `internal_note` и индексы для статуса, времени и
даты создания. Существующие доставки и ограничения не изменяются.

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260911_deliveries_admin.sql"
```

## Синхронизация старых отменённых доставок

Файл миграции: `20260912_reconcile_cancelled_deliveries.sql`.

Однократно приводит старые незавершённые доставки отменённых заказов к статусу
`cancelled`. Доставленные записи и исторические данные не удаляются. Повторный запуск
безопасен.

```powershell
psql -U postgres -d lotus_db -f "D:\Projects\lotus-app\src\db\migrations\20260912_reconcile_cancelled_deliveries.sql"
```

## Персональный доступ сотрудников и назначение курьеров

Файл миграции: `20260916_staff_access.sql`.

Выполните его вручную под владельцем таблиц. Миграция идемпотентно расширяет существующие
`roles` и `user_roles`, создаёт таблицы хешей паролей, сессий, лимитов входа и аудита,
а также добавляет nullable-ссылку `deliveries.courier_user_id`. Существующие пользователи,
текстовые имена курьеров, доставки и исторические заказы не удаляются и не переписываются.
Если прикладная роль называется не `lotus_app`, перед запуском в этом же соединении задайте
`SET lotus.app_role = 'имя_роли';`.

После миграции назначьте личный пароль существующему активному `super_admin` интерактивной
командой `npm run staff:password -- "+992XXXXXXXXX"`. Полный безопасный порядок переключения,
проверки и удаления старых переменных окружения приведён в `docs/staff-access.md`.
