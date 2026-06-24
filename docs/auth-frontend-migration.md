# Auth Frontend Migration

Що треба змінити на фронті, щоб адмінська авторизація не спиралась на прямі запити в Supabase для перевірки доступу, а працювала через бекенд API.

## Current Situation

Старий flow був таким:

1. Логін через `supabase.auth.signInWithPassword`
2. Поточний користувач через `supabase.auth.getUser()`
3. Перевірка admin-доступу через прямий запит у таблицю `profiles`
4. Logout через `supabase.auth.signOut()`

Нова ціль:

1. Логін можна лишити через Supabase Auth
2. Поточний JWT/token фронт отримує через Supabase session
3. Перевірка admin-доступу більше не робиться через `profiles`
4. Admin-доступ перевіряється тільки через `GET /api/admin/me`

## Files

- `app/middleware/admin.ts`
- `app/middleware/auth.ts`
- `app/stores/auth.ts`

## Goal

Фронт має:

- зберігати admin token
- передавати його в бекенд
- перевіряти адмін-доступ через `GET /api/admin/me`

Фронт не повинен:

- напряму вирішувати, чи юзер є `admin`, через власні Supabase-запити до таблиць
- напряму будувати доступ до адмінки на основі `$supabase.from(...)`

## Important Route Clarification

Є два різних маршрути:

- фронт/Nuxt route: `GET /api/admin/me`
- бекенд Fastify route: `GET /v1/admin/me`

Тобто:

```text
browser -> http://localhost:3011/api/admin/me
nuxt server route -> http://127.0.0.1:4000/v1/admin/me
```

Перевірка напряму такого URL:

```text
http://127.0.0.1:4000/api/admin/me
```

дасть `404`, і це нормально, бо `/api/admin/*` не існує на Fastify-бекенді.

## Current Backend Contract

Бекенд уже підтримує:

```http
GET /api/admin/me
Authorization: Bearer <admin token>
```

Успішна відповідь:

```json
{
  "user": {
    "id": "uuid-or-null",
    "email": "admin@example.com",
    "role": "admin",
    "source": "jwt"
  }
}
```

Або для fallback admin key:

```json
{
  "user": {
    "id": null,
    "email": null,
    "role": "admin",
    "source": "api_key"
  }
}
```

Помилки:

- `401` -> токен відсутній або невалідний
- `403` -> токен валідний, але без admin-доступу

## Why You May See 403

`403` означає:

- маршрут знайдено
- токен прочитаний
- але бекенд не вважає користувача адміном

У поточній реалізації бекенд пускає в `/v1/admin/*` тільки якщо виконується одна з умов:

1. у JWT є роль `admin`
2. email користувача входить у `ADMIN_EMAILS`
3. використовується `ADMIN_API_KEY` або `ADMIN_API_KEYS`

Тому `403` не означає проблему маршруту. Це проблема доступу.

## Backend Requirements For Admin Access

Один із варіантів має бути налаштований:

### Variant 1: role in JWT

У користувача в Supabase JWT має бути:

- `app_metadata.role = "admin"`

або

- `user_metadata.role = "admin"`

### Variant 2: ADMIN_EMAILS

У `.env` бекенда:

```env
ADMIN_EMAILS=admin@example.com
```

### Variant 3: ADMIN_API_KEY

У `.env` бекенда:

```env
ADMIN_API_KEY=some-secret-key
```

Цей варіант більше підходить для технічного доступу, не для звичайного user login.

## What Frontend Should Change

## What Stays From Old Supabase Auth

Це можна залишити:

- `signIn` через `supabase.auth.signInWithPassword`
- `signOut` через `supabase.auth.signOut`
- отримання session/token через Supabase Auth

Це треба прибрати:

- читання `profiles.role` з фронта
- рішення на фронті, чи користувач admin, через таблицю `profiles`

## Migration From Old Implementation

### Old `app/stores/auth.ts`

Було:

- `signIn()` логінить через Supabase
- `fetchUser()` тягне `supabase.auth.getUser()`
- store тримає тільки `user`

Має бути:

- `signIn()` лишається через Supabase
- після логіну треба дістати access token із session
- зберегти token у store
- викликати `GET /api/admin/me`
- зберегти `adminUser`

### Old `app/middleware/admin.ts`

Було:

1. `supabase.auth.getUser()`
2. `supabase.from('profiles').select('role')`
3. якщо `role !== admin`, редірект

Має бути:

1. перевірити, що є token
2. викликати `GET /api/admin/me`
3. якщо `401/403`, редірект

### Old `app/middleware/auth.ts`

Було:

- просто `supabase.auth.getUser()`

Має бути:

- або лишити як базову перевірку logged-in state
- або теж перевести на перевірку token/session у store
- але не ходити в `profiles` для ролей

### 1. Store

У `app/stores/auth.ts`:

- зберігати токен для бекенда
- зробити метод `fetchAdminMe()`
- тримати `adminUser`
- тримати статус `isAdminAuthenticated`
- за потреби тримати і `user`, і `adminUser` окремо

Мінімальна модель:

```ts
type AdminUser = {
  id: string | null
  email: string | null
  role: string
  source: 'jwt' | 'api_key'
}
```

### 2. Middleware

У `app/middleware/admin.ts`:

- перед входом в адмінку викликати `GET /api/admin/me`
- якщо успіх -> пускати
- якщо `401` або `403` -> редірект на логін

У `app/middleware/auth.ts`:

- не робити перевірку через прямі Supabase table queries
- або залишити тільки логін-сесію
- а роль admin перевіряти тільки через бекенд

### 3. Admin API Client

Створити спільний client, який автоматично додає:

```http
Authorization: Bearer <token>
```

Приклад:

```ts
export function useAdminApi() {
  const auth = useAuthStore()

  return $fetch.create({
    baseURL: '/api/admin',
    headers: auth.token
      ? {
          Authorization: `Bearer ${auth.token}`
        }
      : {}
  })
}
```

## Recommended Session Handling

Оскільки логін у вас і далі через Supabase, фронту потрібен access token із session.

Приклад:

```ts
const {
  data: { session }
} = await $supabase.auth.getSession()

const accessToken = session?.access_token || null
```

Саме цей token треба передавати в:

```http
Authorization: Bearer <access_token>
```

## Recommended Updated Store Shape

```ts
import type { User } from '@supabase/supabase-js'

type AdminUser = {
  id: string | null
  email: string | null
  role: string
  source: 'jwt' | 'api_key'
}

export const useAuthStore = defineStore('auth', () => {
  const { $supabase } = useNuxtApp()

  const user = ref<User | null>(null)
  const token = ref<string | null>(null)
  const adminUser = ref<AdminUser | null>(null)
  const loading = ref(false)

  async function signIn(email: string, password: string) {
    loading.value = true

    const { data, error } = await $supabase.auth.signInWithPassword({
      email,
      password
    })

    loading.value = false

    if (error) throw error

    user.value = data.user
    token.value = data.session?.access_token || null

    await fetchAdminMe()

    return data
  }

  async function fetchUser() {
    const {
      data: { user: currentUser }
    } = await $supabase.auth.getUser()

    const {
      data: { session }
    } = await $supabase.auth.getSession()

    user.value = currentUser
    token.value = session?.access_token || null
  }

  async function fetchAdminMe() {
    const api = useAdminApi()
    const res = await api('/me')
    adminUser.value = res.user
    return res.user
  }

  async function signOut() {
    await $supabase.auth.signOut()
    user.value = null
    token.value = null
    adminUser.value = null
    await navigateTo('/login')
  }

  return {
    user,
    token,
    adminUser,
    loading,
    signIn,
    signOut,
    fetchUser,
    fetchAdminMe
  }
})
```

## Remove

Прибрати логіку, де фронт напряму:

- перевіряє роль admin через Supabase
- читає окремі таблиці для визначення доступу
- блокує/дозволяє адмінку на основі локальних Supabase table checks

## New Flow

### App startup

1. Дістати токен
2. Зберегти в auth store
3. Викликати `GET /api/admin/me`
4. Якщо успішно, зберегти `adminUser`

### Enter admin page

1. Middleware викликає `GET /api/admin/me`
2. Якщо відповідь успішна, сторінка відкривається
3. Якщо `401/403`, редірект на логін або на головну

### Logout

1. Очистити токен
2. Очистити `adminUser`
3. Почистити admin state

## Suggested Store API

```ts
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    adminUser: null as AdminUser | null,
    isAdminAuthenticated: false
  }),
  actions: {
    async fetchAdminMe() {
      const api = useAdminApi()
      const res = await api('/me')
      this.adminUser = res.user
      this.isAdminAuthenticated = true
      return res.user
    },
    clearAuth() {
      this.token = null
      this.adminUser = null
      this.isAdminAuthenticated = false
    }
  }
})
```

## Suggested Middleware Example

```ts
export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuthStore()

  if (!auth.token) {
    return navigateTo('/login')
  }

  try {
    await auth.fetchAdminMe()
  } catch (_error) {
    auth.clearAuth()
    return navigateTo('/login')
  }
})
```

## Frontend Checklist

1. Винести admin auth перевірку в `GET /api/admin/me`.
2. Додати admin API client з `Authorization` header.
3. Перевести `admin.ts` middleware на бекендову перевірку.
4. Прибрати прямі Supabase table checks для ролі admin.
5. Зберігати `adminUser` у store після успішного `/v1/admin/me`.
6. При `401/403` чистити auth state і редіректити користувача.
7. Не читати `profiles.role` з фронта.

## Important Note

Фронт усе ще може використовувати Supabase login, якщо це ваша поточна схема отримання JWT.

Але після логіну:

- фронт не має напряму вирішувати admin permissions
- це рішення має приймати тільки бекенд через `GET /api/admin/me`
