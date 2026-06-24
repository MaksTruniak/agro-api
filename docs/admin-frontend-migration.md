# Admin Frontend Migration

Чекліст для фронтенду, щоб адмінка перестала ходити напряму в Supabase і працювала через бекенд API.

Важливо: фронтові Vue-сторінки мають ходити не напряму в `http://localhost:4000/v1/admin/*`, а в Nuxt server routes `/api/admin/*`.

Схема має бути така:

```text
Admin page -> /api/admin/* -> backend /v1/admin/*
```

## General

- Прибрати прямі виклики `$supabase` з адмінських сторінок.
- Замінити їх на HTTP-запити в Nuxt routes `/api/admin/*`.
- Передавати `Authorization: Bearer <admin token>`.
- Винести запити в окремий admin API client, а не викликати `fetch` локально з кожної сторінки.

## Important Routing Note

Фронт має викликати:

- `/api/admin/me`
- `/api/admin/products`
- `/api/admin/crops`

а не:

- `/v1/admin/me`
- `/v1/admin/products`
- `/v1/admin/crops`

Nuxt server route повинен прокидувати запит у бекенд:

- `/api/admin/*` -> `/v1/admin/*`

## Auth

Файли:

- `app/middleware/admin.ts`
- `app/middleware/auth.ts`
- `app/stores/auth.ts`

Що змінити:

- Перевірку доступу робити через `GET /api/admin/me`.
- Якщо `401` або `403`, робити редірект на логін.
- Токен передавати в бекенд, а не використовувати для `$supabase.from(...)`.

Ендпоінт:

- `GET /api/admin/me`

## Products

Файли:

- `app/pages/admin/products/index.vue`
- `app/pages/admin/products/create.vue`
- `app/pages/admin/products/[id].vue`

Що змінити:

- Список: `GET /api/admin/products?page=1&limit=15&manufacturer=bayer&q=...`
- Створення: `POST /api/admin/products`
- Деталь: `GET /api/admin/products/:id`
- Оновлення: `PUT /api/admin/products/:id`
- Видалення: `DELETE /api/admin/products/:id`

Важливо:

- Бекенд підтримує `product_line_id`.
- Список продуктів читається з `admin_products_view`.
- Пагінацію брати з `meta.page`, `meta.limit`, `meta.total`, `meta.total_pages`.

## Product Ingredients

Файл:

- `app/pages/admin/products/[id]-ingredients.vue`

Що змінити:

- Список: `GET /api/admin/products/:id/ingredients`
- Створення: `POST /api/admin/products/:id/ingredients`
- Оновлення: `PUT /api/admin/products/:id/ingredients/:linkId`
- Видалення: `DELETE /api/admin/products/:id/ingredients/:linkId`

Важливо:

- Використовувати `item.id` або `item.link_id` з API.
- Більше не використовувати пряме видалення через `$supabase`.

## Product Packages

Файл:

- `app/pages/admin/products/[id]-packages.vue`

Що змінити:

- Список: `GET /api/admin/products/:id/packages`
- Створення: `POST /api/admin/products/:id/packages`
- Оновлення: `PUT /api/admin/products/:id/packages/:packageId`
- Видалення: `DELETE /api/admin/products/:id/packages/:packageId`

Важливо:

- Брати `package_units` з відповіді API.
- Для `delete` і `update` використовувати `item.id` або `item.package_id`.

## Active Ingredients

Файли:

- `app/pages/admin/ingredients/index.vue`
- `app/pages/admin/ingredients/create.vue`
- `app/pages/admin/ingredients/[id].vue`

Що змінити:

- Список: `GET /api/admin/active-ingredients?page=1&limit=50&q=...`
- Деталь: `GET /api/admin/active-ingredients/:id`
- Створення: `POST /api/admin/active-ingredients`
- Оновлення: `PUT /api/admin/active-ingredients/:id`
- Видалення: `DELETE /api/admin/active-ingredients/:id`
- Merge: `POST /api/admin/active-ingredients/merge`

## Crops

Файли:

- `app/pages/admin/crops/index.vue`
- `app/pages/admin/crops/create.vue`
- `app/pages/admin/crops/[id].vue`

Що змінити:

- Список: `GET /api/admin/crops`
- Деталь: `GET /api/admin/crops/:id`
- Створення: `POST /api/admin/crops`
- Оновлення: `PUT /api/admin/crops/:id`
- Видалення: `DELETE /api/admin/crops/:id`

Додатково для селекта категорій:

- `GET /api/admin/crop-categories`

## Problems

Файли:

- `app/pages/admin/problems/index.vue`
- `app/pages/admin/problems/create.vue`
- `app/pages/admin/problems/[id].vue`

Що змінити:

- Список: `GET /api/admin/problems?type=disease`
- Деталь: `GET /api/admin/problems/:id`
- Створення: `POST /api/admin/problems`
- Оновлення: `PUT /api/admin/problems/:id`
- Видалення: `DELETE /api/admin/problems/:id`

## Growth Stages

Файли:

- `app/pages/admin/growth-stages/index.vue`
- `app/pages/admin/growth-stages/create.vue`
- `app/pages/admin/growth-stages/[id].vue`

Що змінити:

- Список: `GET /api/admin/growth-stages`
- Деталь: `GET /api/admin/growth-stages/:id`
- Створення: `POST /api/admin/growth-stages`
- Оновлення: `PUT /api/admin/growth-stages/:id`
- Видалення: `DELETE /api/admin/growth-stages/:id`

## Manufacturers

Файли:

- `app/pages/admin/manufacturers/index.vue`
- `app/pages/admin/manufacturers/create.vue`
- `app/pages/admin/manufacturers/[id].vue`

Що змінити:

- Список: `GET /api/admin/manufacturers`
- Деталь: `GET /api/admin/manufacturers/:id`
- Створення: `POST /api/admin/manufacturers`
- Оновлення: `PUT /api/admin/manufacturers/:id`
- Видалення: `DELETE /api/admin/manufacturers/:id`

Lookup:

- `GET /api/admin/manufacturers?active=true`

## Product Lines

Файл:

- `app/pages/admin/product-lines/index.vue`

Що змінити:

- Список: `GET /api/admin/product-lines`
- Деталь: `GET /api/admin/product-lines/:id`
- Створення: `POST /api/admin/product-lines`
- Оновлення: `PUT /api/admin/product-lines/:id`
- Видалення: `DELETE /api/admin/product-lines/:id`

Lookup:

- `GET /api/admin/product-lines?active=true&manufacturer_id=...`

## Lookups For Forms

Ці дані треба брати з API, не з Supabase:

- `GET /api/admin/manufacturers?active=true`
- `GET /api/admin/product-lines?active=true&manufacturer_id=...`
- `GET /api/admin/formulation-types?active=true`
- `GET /api/admin/package-units`
- `GET /api/admin/active-ingredients?limit=50`
- `GET /api/admin/crops`
- `GET /api/admin/problems`
- `GET /api/admin/growth-stages`

## Second Phase

Поки не чіпати або переносити другим етапом:

- `app/pages/admin/recommendations/index.vue`
- `app/pages/admin/stores/index.vue`
- `app/pages/admin/prices/index.vue`
- `app/pages/admin/alternatives/index.vue`
- `app/pages/admin/compatibility/index.vue`

Для них бекенд ще не дороблений.

## Suggested Order

1. `auth` і спільний admin API client
2. `products/index.vue`
3. `products/create.vue`
4. `products/[id].vue`
5. `products/[id]-ingredients.vue`
6. `products/[id]-packages.vue`
7. `ingredients/*`
8. `manufacturers/*`
9. `crops/*`
10. `problems/*`
11. `growth-stages/*`
12. `product-lines/index.vue`

## Response Contracts

Список:

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "limit": 15,
    "total": 0,
    "total_pages": 0
  }
}
```

Одна сутність:

```json
{
  "item": {}
}
```

Для продукту:

```json
{
  "product": {}
}
```

Успішне видалення:

```json
{
  "ok": true,
  "deleted": true
}
```
