import 'dotenv/config'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://www.agro.basf.ua'

const CATEGORIES = [
  { url: `${BASE_URL}/uk/Products/overview/Inoculants/`, type: 'inoculant' },
  { url: `${BASE_URL}/uk/Products/overview/Гербіциди/`, type: 'herbicide' },
  { url: `${BASE_URL}/uk/Products/overview/Інсектициди/`, type: 'insecticide' },
  { url: `${BASE_URL}/uk/Products/overview/Протруйники/`, type: 'seed_treatment' },
  { url: `${BASE_URL}/uk/Products/overview/Регулятори-росту/`, type: 'growth_regulator' },
  { url: `${BASE_URL}/uk/Products/overview/Родентициди/`, type: 'rodenticide' },
  { url: `${BASE_URL}/uk/Products/overview/Фунгіциди/`, type: 'fungicide' }
]

const formulationMap: Record<string, string> = {
  'капсульна суспензія': 'CS',
  'концентрат суспензії': 'SC',
  'суспензійний концентрат': 'SC',
  'водорозчинні гранули': 'WG',
  'гранули, що диспергуються у воді': 'WG',
  'змочуваний порошок': 'WP',
  'розчинний концентрат': 'SL',
  'концентрат емульсії': 'EC',
  'емульсія масло-в-воді': 'EW',
  'масляна дисперсія': 'OD',
  'суспо-емульсія': 'SE',
  'гранули': 'GR'
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
  imageUrl: string | null
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
      .split(/,|;/)
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

function parseProductTable($: cheerio.CheerioAPI) {
  const result: Record<string, string> = {}

  $('table.p-table tr').each((_, tr) => {
    const key = clean($(tr).find('th').text()).replace(':', '')
    const value = clean($(tr).find('td').text())

    if (key && value) {
      result[key] = value
    }
  })

  return result
}

function getMainImage($: cheerio.CheerioAPI) {
  const img = $('.product-detail-image-slider img').first().length
      ? $('.product-detail-image-slider img').first()
      : $('img').first()

  return (
      firstSrcsetUrl(img.attr('srcset'))
      || normalizeUrl(img.attr('src'))
  )
}

function getSectionTextByHeading($: cheerio.CheerioAPI, heading: string) {
  const found = $('h2, h3')
      .filter((_, el) => clean($(el).text()).toLowerCase().includes(heading.toLowerCase()))
      .first()

  if (!found.length) return ''

  return clean(found.closest('.container, .content-module').text())
}

async function getManufacturerId() {
  const { data, error } = await supabase
      .from('manufacturers')
      .upsert({
        name: 'BASF',
        slug: 'basf',
        country: 'Germany',
        website_url: BASE_URL
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

async function collectProductLinks(page: any): Promise<ProductLink[]> {
  const found = new Map<string, ProductLink>()

  for (const category of CATEGORIES) {
    await page.goto(category.url, { waitUntil: 'networkidle' })

    const items = await page.$$eval('a[href*="/uk/Products/overview/"]', (links: Element[]) => {
      return links.map((link) => {
        const a = link as HTMLAnchorElement
        const img = a.querySelector('img') as HTMLImageElement | null

        return {
          url: a.href?.trim() || '',
          title:
              img?.alt
              || a.getAttribute('title')?.replace(/^View\s+/i, '')
              || a.textContent?.trim()
              || '',
          imageUrl: img?.src || null
        }
      })
    })

    let count = 0

    for (const item of items) {
      if (!item.url || !item.title) continue
      if (!item.url.includes('/uk/Products/overview/')) continue
      if (!item.url.includes('.html')) continue
      if (item.title.length > 90) continue

      found.set(item.url, {
        url: item.url,
        title: item.title,
        imageUrl: item.imageUrl,
        type: category.type
      })

      count++
    }

    console.log(`${category.type}: ${count}`)
  }

  return [...found.values()]
}

async function importProduct(page: any, link: ProductLink, manufacturerId: string) {
  await page.goto(link.url, { waitUntil: 'networkidle' })

  const html = await page.content()
  const $ = cheerio.load(html)

  const table = parseProductTable($)

  const rawName =
      clean(table['Назва'])
      || clean($('h1').first().text())
      || link.title

  const name = normalizeName(rawName)
  const slug = makeSlug(name)

  const formulationText = table['Препаративна форма'] || ''
  const formulationTypeId = await getFormulationTypeId(formulationText)

  const activeIngredients = parseActiveIngredients(
      table['Діючі речовини'] || table['Діюча речовина'] || ''
  )

  const packageText =
      table['Тара']
      || table['Упаковка']
      || table['Пакування']
      || ''

  const packages = parsePackages(packageText)

  const benefits = clean($('.product-detail-benefits').text())
  const application = getSectionTextByHeading($, 'Регламент застосування')
  const features = getSectionTextByHeading($, 'особливості')
  const description =
      clean($('.product-detail-intro').first().text())
      || benefits
      || null

  const { data: savedProduct, error } = await supabase
      .from('products')
      .upsert({
        name,
        slug,
        type: link.type,
        manufacturer_id: manufacturerId,
        formulation_type_id: formulationTypeId,
        description,
        source_url: link.url,
        source_image_url: getMainImage($) || link.imageUrl,
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
      content: benefits,
      sort_order: 1
    },
    {
      section_key: 'application_rates_raw',
      title: 'Регламент застосування',
      content: application,
      sort_order: 2
    },
    {
      section_key: 'application_features',
      title: 'Особливості',
      content: features,
      sort_order: 3
    }
  ])

  console.log(`Imported BASF: ${name}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    locale: 'uk-UA',
    userAgent: 'Mozilla/5.0'
  })

  const links = await collectProductLinks(page)

  console.log(`Found BASF products: ${links.length}`)

  for (const link of links) {
    try {
      await importProduct(page, link, manufacturerId)
    } catch (error) {
      console.error(`Failed BASF: ${link.url}`, error)
    }
  }

  await browser.close()
}

main()