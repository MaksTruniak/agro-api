import 'dotenv/config'
import { Blob, File } from 'node:buffer'
import { ReadableStream, TransformStream } from 'node:stream/web'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

if (typeof globalThis.Blob === 'undefined') {
  ;(globalThis as any).Blob = Blob
}

if (typeof globalThis.File === 'undefined') {
  ;(globalThis as any).File = File
}

if (typeof globalThis.ReadableStream === 'undefined') {
  ;(globalThis as any).ReadableStream = ReadableStream
}

if (typeof globalThis.TransformStream === 'undefined') {
  ;(globalThis as any).TransformStream = TransformStream
}

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = class WebSocket {}
}

const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://nufarm.com'

const CATEGORIES = [
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d0%b3%d0%b5%d1%80%d0%b1%d1%96%d1%86%d0%b8%d0%b4%d0%b8/',
    type: 'herbicide'
  },
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d1%84%d1%83%d0%bd%d0%b3%d1%96%d1%86%d0%b8%d0%b4%d0%b8/',
    type: 'fungicide'
  },
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d1%96%d0%bd%d1%81%d0%b5%d0%ba%d1%82%d0%b8%d1%86%d0%b8%d0%b4%d0%b8/',
    type: 'insecticide'
  },
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d0%bf%d1%80%d0%be%d1%82%d1%80%d1%83%d0%b9%d0%bd%d0%b8%d0%ba%d0%b8/',
    type: 'seed_treatment'
  },
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d0%bc%d0%be%d1%80%d1%84%d0%be%d1%80%d0%b5%d0%b3%d1%83%d0%bb%d1%8f%d1%82%d0%be%d1%80%d0%b8/',
    type: 'growth_regulator'
  },
  {
    url: 'https://nufarm.com/ua/%d0%bd%d0%b0%d1%88%d0%b5-%d0%bf%d0%be%d1%80%d1%82%d1%84%d0%be%d0%bb%d1%96%d0%be/%d0%b0%d0%b4%d1%8e%d0%b2%d0%b0%d0%bd%d1%82%d0%b8/',
    type: 'adjuvant'
  }
] as const

const formulationMap: Record<string, string> = {
  'капсульна суспензія': 'CS',
  'концентрат суспензії': 'SC',
  'суспензійний концентрат': 'SC',
  'гранули, що диспергуються у воді': 'WG',
  'водорозчинні гранули': 'WG',
  'змочуваний порошок': 'WP',
  'водорозчинний порошок': 'SP',
  'розчинний концентрат': 'SL',
  'концентрат, що емульгується': 'EC',
  'концентрат емульсії': 'EC',
  'емульсія масло-в-воді': 'EW',
  'масляна дисперсія': 'OD',
  'суспо-емульсія': 'SE',
  'водний розчин': 'SL',
  'порошок, що змочується': 'WP',
  'кс': 'SC',
  'ск': 'SC',
  'рк': 'SL',
  'ке': 'EC',
  'вг': 'WG',
  'зп': 'WP',
  'sl': 'SL',
  'sc': 'SC',
  'ec': 'EC',
  'wg': 'WG',
  'wp': 'WP',
  'ew': 'EW',
  'od': 'OD',
  'se': 'SE',
  'cs': 'CS'
}

const unitMap: Record<string, string> = {
  мл: 'ml',
  л: 'l',
  г: 'g',
  кг: 'kg'
}

type ProductLink = {
  url: string
  title: string
  type: string
}

type BrowserPage = {
  goto: (url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) => Promise<unknown>
  waitForLoadState: (state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }) => Promise<unknown>
  title: () => Promise<string>
  content: () => Promise<string>
  setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<unknown>
  isClosed?: () => boolean
}

type BrowserSession = {
  getPage: () => Promise<BrowserPage | null>
  close: () => Promise<unknown>
}

type ParsedPackage = {
  label: string
  amount: number
  unit: string
  sort_order: number
}

function clean(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
  return slugify(value.replace(/®|™|\*/g, ''), {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function normalizeName(value: string) {
  return clean(value)
    .replace(/^NEW\s+/i, '')
    .replace(/®|™|\*/g, '')
    .replace(/[, ]+(SC|SL|WP|WG|EC|EW|OD|SE|CS|КС|СК|РК|ВГ|КЕ|ЗП)$/i, '')
    .trim()
}

function normalizeUrl(value?: string | null) {
  const url = clean(value)

  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/')) return `${BASE_URL}${url}`

  return `${BASE_URL}/${url}`
}

function firstSrcsetUrl(value?: string | null) {
  const first = clean(value).split(',')[0]?.trim().split(' ')[0]
  return normalizeUrl(first)
}

function parsePackages(value: string): ParsedPackage[] {
  return clean(value)
    .split(/,|;/)
    .map(item => clean(item))
    .filter(Boolean)
    .flatMap((label, index) => {
      const multiplier = label.match(/^(\d+)\s*[xх×]\s*(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг)$/i)

      if (multiplier) {
        const unit = unitMap[multiplier[3].toLowerCase()]
        if (!unit) return []

        return [{
          label,
          amount: Number(multiplier[2].replace(',', '.')),
          unit,
          sort_order: index + 1
        }]
      }

      const match = label.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг)/i)

      if (!match) return []

      const unit = unitMap[match[2].toLowerCase()]
      if (!unit) return []

      return [{
        label,
        amount: Number(match[1].replace(',', '.')),
        unit,
        sort_order: index + 1
      }]
    })
}

function parseField(text: string, label: string, nextLabels: string[]) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const endPattern = nextLabels
    .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const regex = new RegExp(
    `${escapedLabel}\\s*:?\\s*([\\s\\S]*?)(?=${endPattern ? `${endPattern}\\s*:?|$` : '$'})`,
    'i'
  )

  return clean(text.match(regex)?.[1])
}

function parseFields(text: string) {
  const labels = [
    'ДІЮЧА РЕЧОВИНА',
    'ПРЕПАРАТИВНА ФОРМА',
    'УПАКОВКА',
    'ПЕРЕВАГИ',
    'МЕХАНІЗМ ДІЇ',
    'ПОГЛИНАННЯ І ПЕРЕМІЩЕННЯ У РОСЛИНІ',
    'ІНСТРУКЦІЯ ЩОДО ЗАСТОСУВАННЯ',
    'ОСОБЛИВОСТІ ЗАСТОСУВАННЯ',
    'СВІТОВИЙ ДОСВІД ВИКОРИСТАННЯ',
    'ПЕРЕВІРЕНІ БАКОВІ СУМІШІ',
    'Схожі препарати'
  ]

  const result: Record<string, string> = {}

  for (let index = 0; index < labels.length; index++) {
    result[labels[index]] = parseField(text, labels[index], labels.slice(index + 1))
  }

  return result
}

function parseFormulationCode(value: string) {
  const text = clean(value).toLowerCase()
  const parenthesized = text.match(/\(([a-zа-яіїєґ]{2,4})\)/i)?.[1]?.toLowerCase()
  const englishCode = text.match(/\b(SL|SC|EC|WG|WP|EW|OD|SE|CS)\b/i)?.[1]?.toLowerCase()

  if (parenthesized && formulationMap[parenthesized]) {
    return formulationMap[parenthesized]
  }

  if (englishCode && formulationMap[englishCode]) {
    return formulationMap[englishCode]
  }

  const normalized = text.replace(/\(.+?\)/g, '').trim()
  return formulationMap[normalized] || null
}

async function getManufacturerId() {
  const { data, error } = await supabase
    .from('manufacturers')
    .upsert({
      name: 'Nufarm',
      slug: 'nufarm',
      country: 'Australia',
      website_url: 'https://nufarm.com/ua/'
    }, {
      onConflict: 'slug'
    })
    .select('id')
    .single()

  if (error) throw error

  return data.id
}

async function getPackageUnitId(code: string) {
  const { data } = await supabase
    .from('package_units')
    .select('id')
    .eq('code', code)
    .single()

  return data?.id || null
}

async function getFormulationTypeId(formulationText: string) {
  const code = parseFormulationCode(formulationText)

  if (!code) return null

  const { data } = await supabase
    .from('formulation_types')
    .select('id')
    .eq('code', code)
    .single()

  return data?.id || null
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  })

  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status}`)
  }

  const html = await res.text()

  if (/Attention Required|Cloudflare|you have been blocked/i.test(html)) {
    throw new Error(`Nufarm заблокував HTTP-запит Cloudflare: ${url}`)
  }

  return html
}

async function loadHtml(url: string, page: BrowserPage | null) {
  if (!page) return await fetchHtml(url)

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)

  let title = await page.title()
  let html = await page.content()

  if (
    process.env.NUFARM_HEADLESS === 'false' &&
    (
      /cloudflare|attention required|blocked|just a moment/i.test(title) ||
      /Attention Required|Cloudflare|you have been blocked|Just a moment/i.test(html)
    )
  ) {
    const waitMs = Number(process.env.NUFARM_CLOUDFLARE_WAIT_MS || 120000)
    console.warn(`Nufarm показав Cloudflare. Пройдіть перевірку у відкритому браузері; продовжу через ${Math.round(waitMs / 1000)} секунд.`)
    await new Promise(resolve => setTimeout(resolve, waitMs))

    if (page.isClosed?.()) {
      throw new Error('Браузерна вкладка Nufarm закрилась під час Cloudflare-перевірки. Запустіть ще раз і не закривайте Chromium до завершення імпорту.')
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    title = await page.title()
    html = await page.content()
  }

  if (/cloudflare|attention required|blocked|just a moment/i.test(title)) {
    throw new Error(`Nufarm заблокував браузерний запит Cloudflare: ${url}`)
  }

  if (/Attention Required|Cloudflare|you have been blocked|Just a moment/i.test(html)) {
    throw new Error(`Nufarm заблокував браузерний запит Cloudflare: ${url}`)
  }

  return html
}

async function createBrowserSession(): Promise<BrowserSession> {
  const nodeMajor = Number(process.versions.node.split('.')[0])

  if (nodeMajor < 18) {
    return {
      getPage: async () => null,
      close: async () => undefined
    }
  }

  const playwright = await import('playwright').catch(() => null)

  if (!playwright) {
    return {
      getPage: async () => null,
      close: async () => undefined
    }
  }

  const headless = process.env.NUFARM_HEADLESS !== 'false'

  if (!headless) {
    const profileDir = process.env.NUFARM_BROWSER_PROFILE || '.nufarm-browser'
    const context = await playwright.chromium.launchPersistentContext(profileDir, {
      headless: false,
      locale: 'uk-UA',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    })
    const page = context.pages()[0] || await context.newPage()
    await page.setExtraHTTPHeaders({
      'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8'
    })

    return {
      getPage: async () => {
        const openPage = context.pages().find(item => !item.isClosed()) || await context.newPage()
        await openPage.setExtraHTTPHeaders({
          'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8'
        })
        return openPage
      },
      close: () => context.close()
    }
  }

  const browser = await playwright.chromium.launch({ headless: true })
  const page = await browser.newPage({
    locale: 'uk-UA',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  })
  await page.setExtraHTTPHeaders({
    'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8'
  })

  return {
    getPage: async () => page.isClosed() ? await browser.newPage() : page,
    close: () => browser.close()
  }
}

async function saveActiveIngredient(
  productId: string,
  active: { name: string; concentration: string | null }
) {
  if (!active.name) return

  const { data: ingredient, error: ingredientError } = await supabase
    .from('active_ingredients')
    .upsert({ name: active.name }, { onConflict: 'name' })
    .select('id')
    .single()

  if (ingredientError) throw ingredientError

  const { error } = await supabase
    .from('product_active_ingredients')
    .upsert({
      product_id: productId,
      active_ingredient_id: ingredient.id,
      concentration: active.concentration
    }, {
      onConflict: 'product_id,active_ingredient_id'
    })

  if (error) throw error
}

async function savePackages(productId: string, packages: ParsedPackage[]) {
  for (const item of packages) {
    const unitId = await getPackageUnitId(item.unit)

    if (!unitId) continue

    const { error } = await supabase
      .from('product_packages')
      .upsert({
        product_id: productId,
        amount: item.amount,
        unit: item.unit,
        label: item.label,
        package_unit_id: unitId,
        sort_order: item.sort_order
      }, {
        onConflict: 'product_id,amount,package_unit_id'
      })

    if (error) throw error
  }
}

async function saveContentSections(
  productId: string,
  sections: Array<{
    section_key: string
    title: string
    content: string
    sort_order: number
  }>
) {
  await supabase
    .from('product_content_sections')
    .delete()
    .eq('product_id', productId)

  const rows = sections.filter(item => item.content)

  if (!rows.length) return

  const { error } = await supabase
    .from('product_content_sections')
    .insert(rows.map(item => ({
      product_id: productId,
      ...item
    })))

  if (error) throw error
}

function getMainImage($: cheerio.CheerioAPI) {
  const metaImage =
    $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')

  if (metaImage) return normalizeUrl(metaImage)

  const img = $('main img, article img, .product img, img')
    .filter((_, el) => {
      const src = clean($(el).attr('src'))
      const alt = clean($(el).attr('alt')).toLowerCase()

      if (!src) return false
      if (src.includes('logo')) return false
      if (alt.includes('nufarm ukraine')) return false

      return true
    })
    .first()

  return firstSrcsetUrl(img.attr('srcset')) || normalizeUrl(img.attr('src'))
}

function getDescription($: cheerio.CheerioAPI, fields: Record<string, string>) {
  const h1 = $('h1').first()
  const subtitle = clean(h1.nextAll('h2').first().text())
  const paragraph = clean(h1.nextAll('p').first().text())

  return paragraph || subtitle || fields['ПЕРЕВАГИ'] || null
}

async function collectProductLinks(page: BrowserPage | null): Promise<ProductLink[]> {
  const found = new Map<string, ProductLink>()

  for (const category of CATEGORIES) {
    const html = await loadHtml(category.url, page)
    const $ = cheerio.load(html)
    const items = $('a[href*="/ua/product/"]')
      .map((_, anchor) => {
        const a = $(anchor)
        const heading =
          clean(a.find('h2, h3, .title, .product-title').first().text())
          || clean(a.attr('title'))
          || clean(a.text())

        return {
          url: normalizeUrl(a.attr('href')) || '',
          title: heading
        }
      })
      .get()

    let count = 0

    for (const item of items) {
      if (!item.url || !item.title) continue

      const url = item.url.split('#')[0]
      if (!url.includes('/ua/product/')) continue

      const title = clean(item.title)
        .replace(/\bNEW\b/gi, '')
        .replace(/Показати більше/gi, '')

      if (!title) continue

      found.set(url, {
        url,
        title,
        type: category.type
      })

      count++
    }

    console.log(`${category.type}: ${count}`)
  }

  return [...found.values()]
}

async function importProduct(page: BrowserPage | null, link: ProductLink, manufacturerId: string) {
  const html = await loadHtml(link.url, page)
  const $ = cheerio.load(html)
  const bodyText = clean($('body').text())
  const fields = parseFields(bodyText)

  const rawName = clean($('h1').first().text()) || link.title
  const name = normalizeName(rawName)
  const slug = makeSlug(name)
  const formulationText = fields['ПРЕПАРАТИВНА ФОРМА'] || ''
  const formulationTypeId = await getFormulationTypeId(formulationText)
  const activeIngredients = parseActiveIngredients(fields['ДІЮЧА РЕЧОВИНА'] || '')
  const packages = parsePackages(fields['УПАКОВКА'] || '')

  const { data: savedProduct, error } = await supabase
    .from('products')
    .upsert({
      name,
      slug,
      type: link.type,
      manufacturer_id: manufacturerId,
      formulation_type_id: formulationTypeId,
      description: getDescription($, fields),
      source_url: link.url,
      source_image_url: getMainImage($),
      market_segment: 'professional',
      is_active: true
    }, {
      onConflict: 'slug'
    })
    .select('id')
    .single()

  if (error) throw error

  await supabase
    .from('product_active_ingredients')
    .delete()
    .eq('product_id', savedProduct.id)

  for (const active of activeIngredients) {
    await saveActiveIngredient(savedProduct.id, active)
  }

  await savePackages(savedProduct.id, packages)

  await saveContentSections(savedProduct.id, [
    {
      section_key: 'benefits',
      title: 'Переваги',
      content: fields['ПЕРЕВАГИ'],
      sort_order: 1
    },
    {
      section_key: 'action_mechanism',
      title: 'Механізм дії',
      content: fields['МЕХАНІЗМ ДІЇ'],
      sort_order: 2
    },
    {
      section_key: 'plant_movement',
      title: 'Поглинання і переміщення у рослині',
      content: fields['ПОГЛИНАННЯ І ПЕРЕМІЩЕННЯ У РОСЛИНІ'],
      sort_order: 3
    },
    {
      section_key: 'application_rates_raw',
      title: 'Інструкція щодо застосування',
      content: fields['ІНСТРУКЦІЯ ЩОДО ЗАСТОСУВАННЯ'] || fields['ОСОБЛИВОСТІ ЗАСТОСУВАННЯ'],
      sort_order: 4
    },
    {
      section_key: 'world_experience',
      title: 'Світовий досвід використання',
      content: fields['СВІТОВИЙ ДОСВІД ВИКОРИСТАННЯ'],
      sort_order: 5
    },
    {
      section_key: 'tank_mixes',
      title: 'Перевірені бакові суміші',
      content: fields['ПЕРЕВІРЕНІ БАКОВІ СУМІШІ'],
      sort_order: 6
    }
  ])

  console.log(`Imported Nufarm: ${name}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()
  const browser = await createBrowserSession()

  try {
    const page = await browser.getPage()
    const links = await collectProductLinks(page)

    console.log(`Found Nufarm products: ${links.length}`)

    for (const link of links) {
      try {
        await importProduct(page, link, manufacturerId)
      } catch (error) {
        console.error(`Failed Nufarm: ${link.url}`, error)
      }
    }
  } finally {
    await browser.close()
  }
}

main()
