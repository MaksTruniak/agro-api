# Crops Frontend Migration

Що треба змінити на фронті, щоб адмінка для `crops` перестала ходити напряму в Supabase і працювала через бекенд API.

Важливо: Vue-сторінка має ходити в Nuxt route `/api/admin/crops`, а Nuxt уже має прокидувати це в бекенд `/v1/admin/crops`.

## Files

- `app/pages/admin/crops/index.vue`
- `app/pages/admin/crops/create.vue`
- `app/pages/admin/crops/[id].vue`

## Remove

Прибрати прямі виклики:

```ts
$supabase.from('crops')
```

і, якщо використовується:

```ts
$supabase.from('crop_categories')
```

## Replace With API

### Crops list

Було:

```ts
$supabase
  .from('crops')
  .select('id, name, slug')
  .order('name')
```

Має бути:

```http
GET /api/admin/crops
```

Відповідь:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Пшениця",
      "slug": "pshenytsia",
      "category_id": null
    }
  ]
}
```

### Crop detail

Було:

```ts
$supabase
  .from('crops')
  .select('id, name, slug, category_id')
  .eq('id', id)
  .single()
```

Має бути:

```http
GET /api/admin/crops/:id
```

Відповідь:

```json
{
  "item": {
    "id": "uuid",
    "name": "Пшениця",
    "slug": "pshenytsia",
    "category_id": null
  }
}
```

### Create crop

Було:

```ts
$supabase.from('crops').insert({
  name,
  slug
})
```

Має бути:

```http
POST /api/admin/crops
Content-Type: application/json
Authorization: Bearer <admin token>
```

Body:

```json
{
  "name": "Пшениця",
  "slug": "pshenytsia",
  "category_id": null
}
```

Відповідь:

```json
{
  "item": {
    "id": "uuid",
    "name": "Пшениця",
    "slug": "pshenytsia",
    "category_id": null
  }
}
```

### Update crop

Було:

```ts
$supabase
  .from('crops')
  .update({
    name,
    slug
  })
  .eq('id', id)
```

Має бути:

```http
PUT /api/admin/crops/:id
Content-Type: application/json
Authorization: Bearer <admin token>
```

Body:

```json
{
  "name": "Пшениця озима",
  "slug": "pshenytsia-ozyma",
  "category_id": null
}
```

Відповідь:

```json
{
  "item": {
    "id": "uuid",
    "name": "Пшениця озима",
    "slug": "pshenytsia-ozyma",
    "category_id": null
  }
}
```

### Delete crop

Було:

```ts
$supabase
  .from('crops')
  .delete()
  .eq('id', id)
```

Має бути:

```http
DELETE /api/admin/crops/:id
Authorization: Bearer <admin token>
```

Відповідь:

```json
{
  "ok": true,
  "deleted": true
}
```

## Crop Categories

Якщо форма `crops` використовує категорії, більше не читати їх напряму з Supabase.

Має бути:

```http
GET /api/admin/crop-categories
```

Відповідь:

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Зернові"
    }
  ]
}
```

## Frontend Checklist

1. У `index.vue` замінити читання списку на `GET /api/admin/crops`.
2. У `create.vue` замінити `insert` на `POST /api/admin/crops`.
3. У `[id].vue` замінити `select single` на `GET /api/admin/crops/:id`.
4. У `[id].vue` замінити `update` на `PUT /api/admin/crops/:id`.
5. У списку або формі замінити `delete` на `DELETE /api/admin/crops/:id`.
6. Якщо є селект категорій, тягнути його з `GET /api/admin/crop-categories`.
7. Усі запити робити через admin API client, не через `$supabase`.

## Minimal Client Example

```ts
export const adminCropsApi = {
  list: () => $fetch('/api/admin/crops'),
  get: (id: string) => $fetch(`/api/admin/crops/${id}`),
  create: (body: { name: string; slug?: string; category_id?: string | null }) =>
    $fetch('/api/admin/crops', { method: 'POST', body }),
  update: (id: string, body: { name?: string; slug?: string; category_id?: string | null }) =>
    $fetch(`/api/admin/crops/${id}`, { method: 'PUT', body }),
  remove: (id: string) =>
    $fetch(`/api/admin/crops/${id}`, { method: 'DELETE' }),
  categories: () => $fetch('/api/admin/crop-categories')
}
```
