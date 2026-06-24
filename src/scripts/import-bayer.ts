import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://www.cropscience.bayer.ua'

const CATEGORIES = [
  { path: '/Products/Herbicides', type: 'herbicide' },
  { path: '/Products/Insecticides', type: 'insecticide' },
  { path: '/Products/Fungicides', type: 'fungicide' },
  { path: '/Products/Seed-Treatment', type: 'seed_treatment' },
  { path: '/Products/GrowthRegulators', type: 'growth_regulator' },
  { path: '/Products/Adjuvants', type: 'adjuvant' },
  { path: '/Products/Dekalb', type: 'seed' }
]

const formulationMap: Record<string, string> = {
  'концентрат суспензії': 'SC',
  'суспензійний концентрат': 'SC',
  'гранули, що диспергуються у воді': 'WG',
  'водорозчинні гранули': 'WG',
  'змочуваний порошок': 'WP',
  'водорозчинний порошок': 'SP',
  'розчинний концентрат': 'SL',
  'концентрат емульсії': 'EC',
  'емульсія масло-в-воді': 'EW',
  'масляна дисперсія': 'OD',
  'супо-емульсія': 'SE',
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
}

type ParsedPackage = {
  label: string
  amount: number
  unit: string
  sort_order: number
}

function clean(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
  return slugify(value.replace(/®/g, ''), {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function parseDefinitionFields($: cheerio.CheerioAPI) {
  const result: Record<string, string> = {}

  $('dt').each((_, dt) => {
    const key = clean($(dt).text()).replace(':', '')
    const value = clean($(dt).next('dd').text())

    if (key && value) {
      result[key] = value
    }
  })

  return result
}

function normalizeName(value: string) {
  return clean(value)
      .replace(/®/g, '')
      .replace(/[, ]+(SC|SL|WP|WG|EC|EW|OD|SE|КС|РК|ВГ|КЕ|ВП)$/i, '')
      .trim()
}

function normalizeUrl(href: string) {
  return href.startsWith('http') ? href : `${BASE_URL}${href}`
}

function parsePackages(value: string): ParsedPackage[] {
  return clean(value)
      .split(/,|;/)
      .map(item => item.trim())
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
  const endPattern = nextLabels
      .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')

  const regex = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*([\\s\\S]*?)(?=${endPattern}\\s*:?|$)`,
      'i'
  )

  return clean(text.match(regex)?.[1])
}

function parseFields(text: string) {
  const labels = [
    'Діюча речовина',
    'Препаративна форма',
    'Механізм дії',
    'Властивості',
    'Селективність',
    'Застосування',
    'Переваги',
    'Норма застосування',
    'Спектр дії',
    'Реєстраційне посвідчення',
    'Тара'
  ]

  const result: Record<string, string> = {}

  for (let i = 0; i < labels.length; i++) {
    result[labels[i]] = parseField(text, labels[i], labels.slice(i + 1))
  }

  return result
}

async function fetchHtml(url: string) {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status}`)
  }

  return await res.text()
}

async function getManufacturerId() {
  const { data, error } = await supabase
      .from('manufacturers')
      .upsert({
        name: 'Bayer',
        slug: 'bayer',
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
  const normalized = clean(formulationText).toLowerCase()
  const code = formulationMap[normalized]

  if (!code) return null

  const { data } = await supabase
      .from('formulation_types')
      .select('id')
      .eq('code', code)
      .single()

  return data?.id || null
}

async function collectProductLinks(): Promise<ProductLink[]> {
  const links = new Map<string, ProductLink>()

  for (const category of CATEGORIES) {
    const sampleUrl =
        category.path === '/Products/Herbicides'
            ? `${BASE_URL}/Products/Herbicides/Adengo.aspx`
            : `${BASE_URL}${category.path}`

    const html = await fetchHtml(sampleUrl)
    const $ = cheerio.load(html)

    $(`a[href*="${category.path}/"]`).each((_, el) => {
      const href = $(el).attr('href')
      const title = clean($(el).text())

      if (title.includes('Каталог гібридів')) return
      if (title.startsWith('»')) return
      if (!href || !title) return

      const url = normalizeUrl(href)

      if (!url.includes(category.path)) return
      if (url.includes('Crop_Protection')) return
      if (url.includes('SafeUse')) return

      links.set(url, {
        url,
        title,
        type: category.type
      })
    })

    console.log(`${category.path}: collected`)
  }

  return [...links.values()]
}

function getImage($: cheerio.CheerioAPI) {
  const src =
      $('img[src*="/Products/"]').first().attr('src')
      || $('img[src*="/products/"]').first().attr('src')
      || $('img').map((_, img) => $(img).attr('src')).get()
          .find(item => item && !item.includes('logo') && !item.includes('spacer'))

  return src ? normalizeUrl(src) : null
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

async function saveContentSections(productId: string, fields: Record<string, string>) {
  await supabase
      .from('product_content_sections')
      .delete()
      .eq('product_id', productId)

  const sections = [
    { section_key: 'action_mechanism', title: 'Механізм дії', content: fields['Механізм дії'], sort_order: 1 },
    { section_key: 'properties', title: 'Властивості', content: fields['Властивості'], sort_order: 2 },
    { section_key: 'selectivity', title: 'Селективність', content: fields['Селективність'], sort_order: 3 },
    { section_key: 'application_rates_raw', title: 'Застосування', content: fields['Застосування'], sort_order: 4 },
    { section_key: 'benefits', title: 'Переваги', content: fields['Переваги'], sort_order: 5 },
    { section_key: 'target_spectrum', title: 'Спектр дії', content: fields['Спектр дії'], sort_order: 6 },
    { section_key: 'registration', title: 'Реєстраційне посвідчення', content: fields['Реєстраційне посвідчення'], sort_order: 7 }
  ].filter(item => item.content)

  if (!sections.length) return

  const { error } = await supabase
      .from('product_content_sections')
      .insert(sections.map(item => ({
        product_id: productId,
        ...item
      })))

  if (error) throw error
}

async function importProduct(link: ProductLink, manufacturerId: string) {
  const html = await fetchHtml(link.url)
  const $ = cheerio.load(html)

  const bodyText = clean($('body').text())
  const fields = {
    ...parseFields(bodyText),
    ...parseDefinitionFields($)
  }

  const rawName = clean($('h1').first().text()) || link.title
  const name = normalizeName(rawName)
  const slug = makeSlug(name)

  const activeIngredients = parseActiveIngredients(
      fields['Діюча речовина'] || ''
  )

  const formulationTypeId = await getFormulationTypeId(fields['Препаративна форма'] || '')
  const packages = parsePackages(fields['Тара'] || '')

  const description =
      fields['Механізм дії']
      || fields['Властивості']
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
        source_image_url: getImage($),
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
  await saveContentSections(savedProduct.id, fields)

  console.log(`Imported Bayer: ${name}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()
  const links = await collectProductLinks()

  console.log(`Found Bayer products: ${links.length}`)

  for (const link of links) {
    try {
      await importProduct(link, manufacturerId)
    } catch (error) {
      console.error(`Failed Bayer: ${link.url}`, error)
    }
  }
}

main()