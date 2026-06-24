import 'dotenv/config'
import { Blob, File } from 'node:buffer'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import { chromium, type Page } from 'playwright'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

if (typeof globalThis.Blob === 'undefined') {
  ;(globalThis as any).Blob = Blob
}

if (typeof globalThis.File === 'undefined') {
  ;(globalThis as any).File = File
}

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://www.adama.com'
const SITE_URL = 'https://www.adama.com/ukraine/ua'

const CATEGORIES = [
  {
    url: `${SITE_URL}/products/crop-protection?f%5B0%5D=treatment%3A666`,
    type: 'herbicide'
  },
  {
    url: `${SITE_URL}/products/crop-protection?f%5B0%5D=treatment%3A681`,
    type: 'fungicide'
  },
  {
    url: `${SITE_URL}/products/crop-protection?f%5B0%5D=treatment%3A661`,
    type: 'insecticide'
  },
  {
    url: `${SITE_URL}/products/crop-protection?f%5B0%5D=treatment%3A676`,
    type: 'seed_treatment'
  },
  {
    url: `${SITE_URL}/products/crop-protection?f%5B0%5D=treatment%3A671`,
    type: 'microfertilizer'
  }
] as const

const treatmentClassMap: Record<string, string> = {
  'icon-herbicide': 'herbicide',
  'icon-fungicide': 'fungicide',
  'icon-insecticide': 'insecticide',
  'icon-seed-treatment': 'seed_treatment',
  'icon-fertilizer': 'microfertilizer',
  'icon-microfertilizer': 'microfertilizer',
  'icon-adjuvant': 'adjuvant',
  'icon-growth-regulator': 'growth_regulator'
}

const treatmentNameMap: Record<string, string> = {
  'гербіциди': 'herbicide',
  'гербіцид': 'herbicide',
  'фунгіциди': 'fungicide',
  'фунгіцид': 'fungicide',
  'інсектициди': 'insecticide',
  'інсектицид': 'insecticide',
  'протруйники та інше': 'seed_treatment',
  'протруйники': 'seed_treatment',
  'мікродобрива': 'microfertilizer',
  'добрива': 'microfertilizer'
}

const formulationMap: Record<string, string> = {
  'капсульна суспензія': 'CS',
  'концентрат суспензії': 'SC',
  'суспензійний концентрат': 'SC',
  'водорозчинні гранули': 'WG',
  'гранули, що диспергуються у воді': 'WG',
  'гранули що диспергуються у воді': 'WG',
  'змочуваний порошок': 'WP',
  'водорозчинний порошок': 'SP',
  'розчинний концентрат': 'SL',
  'концентрат емульсії': 'EC',
  'емульсія масло-в-воді': 'EW',
  'масляна дисперсія': 'OD',
  'суспо-емульсія': 'SE',
  'кс': 'SC',
  'к.е.': 'EC',
  'к.е': 'EC',
  'к.с.': 'SC',
  'р.к.': 'SL',
  'в.г.': 'WG'
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
  return slugify(value.replace(/®|™/g, ''), {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function normalizeName(value: string) {
  return clean(value)
    .replace(/®|™/g, '')
    .replace(/[, ]+(SC|SL|WP|WG|EC|EW|OD|SE|CS|КС|РК|ВГ|КЕ|ВП|СК)$/i, '')
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
    .split(/,|;|\n/)
    .map(item => clean(item))
    .filter(Boolean)
    .map((label, index) => {
      const match = label.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг)/i)

      if (!match) return null

      const unit = unitMap[match[2].toLowerCase()]
      if (!unit) return null

      return {
        label,
        amount: Number(match[1].replace(',', '.')),
        unit,
        sort_order: index + 1
      }
    })
    .filter(Boolean) as ParsedPackage[]
}

function parseField(text: string, label: string, nextLabels: string[]) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const endPattern = nextLabels
    .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const regex = new RegExp(
    `${escapedLabel}\s*:?\s*([\\s\\S]*?)(?=${endPattern ? `${endPattern}\\s*:?|$` : '$'})`,
    'i'
  )

  return clean(text.match(regex)?.[1])
}

function parseFields(text: string) {
  const labels = [
    'Діюча речовина та концентрація',
    'Діюча речовина',
    'Діючі речовини',
    'Препаративна форма',
    'Пакування',
    'Пакування препарату',
    'Хімічна група',
    'Розподіл у рослині (або спосіб дії)',
    'Розподіл у рослині',
    'Норма витрати робочого розчину',
    'Норма витрати',
    'Шкідливий об\'єкт',
    'Шкідливі об\'єкти',
    'Культури'
  ]

  const result: Record<string, string> = {}

  for (let index = 0; index < labels.length; index++) {
    result[labels[index]] = parseField(text, labels[index], labels.slice(index + 1))
  }

  return result
}

function getComponentBlockContentByTitle($: cheerio.CheerioAPI, titlePattern: string | RegExp) {
  const normalizedPattern = typeof titlePattern === 'string'
    ? titlePattern.toLowerCase()
    : null

  const title = $('.component-block--title, .component-block__title, h2, h3, h4')
    .filter((_, el) => {
      const text = clean($(el).text())
      if (!text) return false

      if (titlePattern instanceof RegExp) {
        return titlePattern.test(text)
      }

      return text.toLowerCase().includes(normalizedPattern!)
    })
    .first()

  if (!title.length) return ''

  const block = title.closest('.component-block, .accordion-item, .field, .paragraph, section, .block')

  if (block.length) {
    const content = clean(
      block.find('.component-block--content, .component-block__content, .js-accordion-content, .field__item, .content').first().text()
    )

    if (content) return content
  }

  const nextContent = clean(
    title.nextAll('.component-block--content, .component-block__content, .js-accordion-content, .field__item, .content').first().text()
  )

  return nextContent
}

function getListSectionText($: cheerio.CheerioAPI, titleClass: string) {
  const title = $(`.${titleClass}`).first()

  if (!title.length) return ''

  const block = title.closest('.component-block, .accordion-item, .field, section, .block')
  if (block.length) {
    const content = clean(block.find('.js-accordion-content, .component-block--content, .component-block__content').first().text())
    if (content) return content
  }

  return clean(title.nextAll('.js-accordion-content, .component-block--content, .component-block__content').first().text())
}

function getMainImage($: cheerio.CheerioAPI) {
  const img = $('img[alt], .media img, .field--name-field-image img, .swiper img').filter((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || ''
    return Boolean(src) && !src.includes('logo')
  }).first()

  return (
    firstSrcsetUrl(img.attr('srcset'))
    || normalizeUrl(img.attr('src'))
    || normalizeUrl(img.attr('data-src'))
  )
}

function resolveType($: cheerio.CheerioAPI, fallbackType: string) {
  const treatment = $('.taxonomy-term-treatment--name').first()
  const treatmentText = clean(treatment.text()).toLowerCase()
  const classAttr = treatment.attr('class') || ''

  for (const [className, type] of Object.entries(treatmentClassMap)) {
    if (classAttr.includes(className)) {
      return type
    }
  }

  for (const [label, type] of Object.entries(treatmentNameMap)) {
    if (treatmentText.includes(label)) {
      return type
    }
  }

  return fallbackType
}

async function fetchHtml(page: Page, url: string) {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })

  await page.waitForTimeout(3000)

  const html = await page.content()

  if (/access denied/i.test(html)) {
    throw new Error(`Access denied ${url}`)
  }

  return html
}

async function getManufacturerId() {
  const { data, error } = await supabase
    .from('manufacturers')
    .upsert({
      name: 'Adama',
      slug: 'adama',
      country: 'Israel',
      website_url: SITE_URL
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
  const normalized = clean(formulationText)
    .replace(/\(.+?\)/g, '')
    .toLowerCase()

  const code = formulationMap[normalized]

  if (!code) return null

  const { data } = await supabase
    .from('formulation_types')
    .select('id')
    .eq('code', code)
    .single()

  return data?.id || null
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

async function saveContentSections(productId: string, sections: Array<{
  section_key: string
  title: string
  content: string
  sort_order: number
}>) {
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

async function collectProductLinks(page: Page): Promise<ProductLink[]> {
  const found = new Map<string, ProductLink>()

  for (const category of CATEGORIES) {
    const html = await fetchHtml(page, category.url)
    const $ = cheerio.load(html)
    const browserLinks = await page.$$eval('a[href*="/ukraine/ua/crop-protection/"]', (links: Element[]) => {
      return links.map((link) => {
        const a = link as HTMLAnchorElement
        const cardTitle =
          a.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim()
          || a.getAttribute('aria-label')
          || a.getAttribute('title')
          || a.textContent?.trim()
          || ''

        return {
          url: a.href?.trim() || '',
          title: cardTitle
        }
      })
    })

    $('a[href*="/ukraine/ua/crop-protection/"]').each((_, el) => {
      const href = $(el).attr('href')
      const url = normalizeUrl(href)

      if (!url) return
      if (url.includes('/products/crop-protection')) return

      const title = clean(
        $(el).find('h2, h3, h4, .field--name-title, .card__title, .product-title').first().text()
        || $(el).attr('aria-label')
        || $(el).attr('title')
        || $(el).text()
      )

      if (!title) return
      if (title.length > 120) return

      found.set(url, {
        url,
        title,
        type: category.type
      })
    })

    for (const item of browserLinks) {
      const url = normalizeUrl(item.url)
      const title = clean(item.title)

      if (!url) continue
      if (url.includes('/products/crop-protection')) continue
      if (!title) continue
      if (title.length > 120) continue

      found.set(url, {
        url,
        title,
        type: category.type
      })
    }

    const categoryLinks = [...found.values()].filter(item => item.type === category.type)
    console.log(`${category.type}: ${categoryLinks.length}`)
  }

  return [...found.values()]
}

async function importProduct(page: Page, link: ProductLink, manufacturerId: string) {
  const html = await fetchHtml(page, link.url)
  const $ = cheerio.load(html)

  const bodyText = clean($('body').text())
  const fields = parseFields(bodyText)

  const rawName = clean($('h1').first().text()) || link.title
  const name = normalizeName(rawName)
  const slug = makeSlug(name)

  const activeIngredientsText =
    getComponentBlockContentByTitle($, /діюча речовина|діючі речовини/i)
    || fields['Діюча речовина та концентрація']
    || fields['Діюча речовина']
    || fields['Діючі речовини']
    || ''

  const formulationText =
    getComponentBlockContentByTitle($, /препаративна форма/i)
    || fields['Препаративна форма']
    || ''

  const packageText =
    getComponentBlockContentByTitle($, /пакування/i)
    || fields['Пакування']
    || fields['Пакування препарату']
    || ''

  const keyTargets =
    getListSectionText($, 'key-targets--title')
    || fields['Шкідливий об\'єкт']
    || fields['Шкідливі об\'єкти']
    || ''

  const crops =
    getListSectionText($, 'crops--title')
    || fields['Культури']
    || ''

  const characteristics =
    getComponentBlockContentByTitle($, /характеристика/i)
    || ''

  const application =
    getComponentBlockContentByTitle($, /регламент застосування|інструкція застосування/i)
    || ''

  const benefits =
    getComponentBlockContentByTitle($, /переваги/i)
    || ''

  const description =
    clean($('.field--name-field-summary, .hero__summary, .product-hero__summary, .lead, .intro, p').first().text())
    || benefits
    || characteristics
    || null

  const activeIngredients = parseActiveIngredients(activeIngredientsText)
  const formulationTypeId = await getFormulationTypeId(formulationText)
  const packages = parsePackages(packageText)
  const type = resolveType($, link.type)

  const { data: savedProduct, error } = await supabase
    .from('products')
    .upsert({
      name,
      slug,
      type,
      manufacturer_id: manufacturerId,
      formulation_type_id: formulationTypeId,
      description,
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
      section_key: 'target_spectrum',
      title: 'Шкідливі об\'єкти',
      content: keyTargets,
      sort_order: 1
    },
    {
      section_key: 'crops',
      title: 'Культури',
      content: crops,
      sort_order: 2
    },
    {
      section_key: 'characteristics',
      title: 'Характеристика',
      content: characteristics,
      sort_order: 3
    },
    {
      section_key: 'application_rates_raw',
      title: 'Регламент застосування',
      content: application,
      sort_order: 4
    },
    {
      section_key: 'benefits',
      title: 'Переваги',
      content: benefits,
      sort_order: 5
    }
  ])

  console.log(`Imported Adama: ${name}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()
  const browser = await chromium.launch({
    headless: true
  })
  const page = await browser.newPage({
    locale: 'uk-UA',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  })
  await page.setExtraHTTPHeaders({
    'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8'
  })

  const links = await collectProductLinks(page)

  console.log(`Found Adama products: ${links.length}`)

  for (const link of links) {
    try {
      await importProduct(page, link, manufacturerId)
    } catch (error) {
      console.error(`Failed Adama: ${link.url}`, error)
    }
  }

  await browser.close()
}

main()
