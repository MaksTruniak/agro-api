import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://www.ukravit.ua'

const SECTIONS = [
  { url: `${BASE_URL}/gerbitsidi/`, type: 'herbicide', marketSegment: 'professional' },
  { url: `${BASE_URL}/fungitsidi/`, type: 'fungicide', marketSegment: 'professional' },
  { url: `${BASE_URL}/insektitsidi/`, type: 'insecticide', marketSegment: 'professional' },
  { url: `${BASE_URL}/protruyniki/`, type: 'seed_treatment', marketSegment: 'professional' },
  { url: `${BASE_URL}/mikrodobriva/`, type: 'fertilizer', marketSegment: 'professional' },
  { url: `${BASE_URL}/aduvanti/`, type: 'adjuvant', marketSegment: 'professional' },
  { url: `${BASE_URL}/desikanti/`, type: 'desiccant', marketSegment: 'professional' },
  { url: `${BASE_URL}/regulyatory-rosta/`, type: 'growth_regulator', marketSegment: 'professional' },
  { url: `${BASE_URL}/fumiganty/`, type: 'fumigant', marketSegment: 'professional' },
  { url: `${BASE_URL}/rodentitsidi/`, type: 'rodenticide', marketSegment: 'professional' },
  { url: `${BASE_URL}/nasinnya/`, type: 'seed', marketSegment: 'professional' },
  { url: `${BASE_URL}/rkd/`, type: 'liquid_complex_fertilizer', marketSegment: 'professional' },
  { url: `${BASE_URL}/inokulyanti/`, type: 'inoculant', marketSegment: 'professional' },
  { url: `${BASE_URL}/inshi-tovari/`, type: 'other', marketSegment: 'professional' },

  { url: `${BASE_URL}/privatniy-protruyniki/`, type: 'seed_treatment', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-gerbitsidi/`, type: 'herbicide', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-fungitsidi/`, type: 'fungicide', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-insektitsidi/`, type: 'insecticide', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-regulyatori-rostu/`, type: 'growth_regulator', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-dopomizhni-rechovini/`, type: 'adjuvant', marketSegment: 'consumer' },
  { url: `${BASE_URL}/kompleksi-dlya-zahistu-roslin/`, type: 'bio_product', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-rodentitsidi/`, type: 'rodenticide', marketSegment: 'consumer' },
  { url: `${BASE_URL}/privatniy-pobutovi-zasobi-zakhistu/`, type: 'disinfectant', marketSegment: 'consumer' }
]

const formulationMap: Record<string, string> = {
  'концентрат суспензії': 'SC',
  'гранули, що диспергуються у воді': 'WG',
  'водорозчинні гранули': 'WG',
  'змочуваний порошок': 'WP',
  'водорозчинний порошок': 'SP',
  'розчинний концентрат': 'SL',
  'концентрат емульсії': 'EC',
  'гранули': 'GR',
  'рідина': 'LIQ',
  'суспо-емульсія': 'SE'
}

const unitMap: Record<string, string> = {
  мл: 'ml',
  л: 'l',
  г: 'g',
  кг: 'kg',
  шт: 'pcs'
}

type ProductLink = {
  url: string
  title: string
  description: string
  marketSegment: string
  type: string
  imageUrl: string | null
}

type ParsedPackage = {
  label: string
  amount: number
  unit: string
  sort_order: number
}

type ActiveIngredient = {
  name: string
  concentration: string | null
}

type ParsedProduct = {
  name: string
  slug: string
  type: string
  market_segment: string
  description: string | null
  source_url: string
  source_image_url: string | null
  activeIngredients: ActiveIngredient[]
  formulationText: string
  packages: ParsedPackage[]
  contentSections: Array<{
    section_key: string
    title: string
    content: string
    sort_order: number
  }>
}

function clean(value?: string | null) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
  return slugify(value.replace(/®/g, ''), {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function normalizeName(value: string) {
  return clean(value)
    .replace(/®/g, '')
    .replace(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг|шт)$/i, '')
    .replace(/^ТОП\s+/i, '')
    .replace(/^Новинка\s+/i, '')
    .replace(/[, ]+(РК|КС|ВП|КЕ|ВГ|РГ|SC|SL|WP|WG|EC)$/i, '')
    .trim()
}

function extractPackageFromTitle(value: string) {
  const match = value.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг|шт)$/i)
  return match?.[0] || ''
}

function parsePackages(value: string): ParsedPackage[] {
  return clean(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map((label, index) => {
      const match = label.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг|шт)/i)

      if (!match) return null

      const unitUa = match[2].toLowerCase()
      const unit = unitMap[unitUa]

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeUkrText(value: string) {
  return value
    .replace(/i/g, 'і')
    .replace(/I/g, 'І')
}

function parseBlock(text: string, start: string, endLabels: string[]) {
  const normalizedText = normalizeUkrText(text)

  const escapedStart = escapeRegExp(normalizeUkrText(start))
  const endPattern = endLabels
    .map(label => escapeRegExp(normalizeUkrText(label)))
    .join('|')

  const regex = new RegExp(
    `${escapedStart}\\s*([\\s\\S]*?)(?=${endPattern}|$)`,
    'i'
  )

  const match = normalizedText.match(regex)

  return clean(match?.[1])
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
      name: 'UKRAVIT',
      slug: 'ukravit',
      country: 'Ukraine',
      website_url: 'https://www.ukravit.ua'
    }, {
      onConflict: 'slug'
    })
    .select('id')
    .single()

  if (error) throw error

  return data.id
}

async function getFormulationTypeId(formulationText?: string) {
  const normalized = clean(formulationText).toLowerCase()

  if (!normalized) return null

  const code = formulationMap[normalized]

  if (!code) return null

  const { data, error } = await supabase
    .from('formulation_types')
    .select('id')
    .eq('code', code)
    .single()

  if (error) return null

  return data.id
}

async function getPackageUnitId(code: string) {
  const { data, error } = await supabase
    .from('package_units')
    .select('id')
    .eq('code', code)
    .single()

  if (error) return null

  return data.id
}

function isBadUrl(fullUrl: string) {
  const blocked = [
    'prom',
    'privatniy-sektor',
    'profesiyni-dezzasobi',
    'interaktivna-shema',
    'agronomic-services-and-research',
    'finance',
    'usaid',
    'utilizaciya-tari',
    'about',
    'contacts',
    'regional',
    'payment-delivery',
    'zvitnist',
    'audit-finansovoyi-zvitnosti',
    'preorder',
    'terms',
    'privacy',
    'politika',
    'cookie',
    'cart',
    'checkout',
    'my-account'
  ]

  const slug = fullUrl.split('/').filter(Boolean).pop() || ''
  return blocked.includes(slug)
}

async function collectProductLinks(): Promise<ProductLink[]> {
  const products = new Map<string, ProductLink>()

  for (const section of SECTIONS) {
    for (let page = 1; page <= 80; page++) {
      const pageUrl = page === 1
        ? section.url
        : `${section.url}page/${page}/`

      let html = ''

      try {
        html = await fetchHtml(pageUrl)
      } catch {
        break
      }

      const $ = cheerio.load(html)
      let found = 0

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return

        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`

        if (!fullUrl.startsWith(`${BASE_URL}/`)) return
        if (isBadUrl(fullUrl)) return
        if (fullUrl.includes('#')) return

        const isDirectProductUrl = /^https:\/\/www\.ukravit\.ua\/[^/]+\/?$/.test(fullUrl)
        if (!isDirectProductUrl) return

        const card = $(el).closest('article, .product, .products__item, .catalog__item, .product-card, .item, li, div')
        const cardText = clean(card.text())
        const linkText = clean($(el).text())

        const productKeywords = [
          'діюча речовина',
          'препаративна форма',
          'гербіцид',
          'фунгіцид',
          'інсектицид',
          'протруйник',
          'мікродобриво',
          'ад’ювант',
          "ад'ювант",
          'десикант',
          'регулятор росту',
          'фумігант',
          'родентицид',
          'інокулянт',
          'насіння',
          'ркд',
          'деззасіб'
        ]

        const textToCheck = `${cardText} ${linkText}`.toLowerCase()

        if (!productKeywords.some(keyword => textToCheck.includes(keyword))) return

        let title = linkText

        if (
          !title
          || title.toLowerCase().includes('дізнатись')
          || title.toLowerCase().includes('купити')
          || title.length > 90
        ) {
          const lines = cardText
            .replace(/Дізнатись більше про препарат/gi, '')
            .replace(/Детальніше/gi, '')
            .split(/\s{2,}|\n/)
            .map(clean)
            .filter(Boolean)

          title = lines[0] || ''
        }

        title = clean(title)

        const badTitles = [
          'Ад’юванти',
          "Ад'юванти",
          'Гербіциди',
          'Десиканти',
          'Допоміжні речовини',
          'Інокулянти',
          'Інсектициди',
          'Інші товари',
          'Комплекси для захисту рослин',
          'Мікродобрива',
          'Насіння',
          'Побутові засоби захисту',
          'Протруйники',
          'Регулятори росту',
          'РКД',
          'Родентициди',
          'Фуміганти',
          'Фунгіциди',
          'Каталог',
          'Меню',
          'Промислові товари',
          'Професійні деззасоби',
          'Інтерактивна схема',
          'Агрономічні послуги та дослідження',
          'Ukravit Finance',
          'Допомога від USAID АГРО',
          'Утилізація тари',
          'Про нас',
          'Контакти',
          'Оплата та доставка',
          'Звітність',
          'Аудит фінансової звітності',
          'Бронювання',
          'Правила користування сайтом',
          'Політика конфіденційності'
        ]

        if (!title || badTitles.includes(title)) return
        if (title.length > 90) return

        const image =
          $(el).find('img').attr('src')
          || card.find('img').first().attr('src')
          || null

        const fullImage = image
          ? image.startsWith('http') ? image : `${BASE_URL}${image}`
          : null

        const description = cardText
          .replace(title, '')
          .replace(/Дізнатись більше про препарат/gi, '')
          .replace(/Детальніше/gi, '')
          .trim()

        products.set(`${fullUrl}-${section.marketSegment}`, {
          url: fullUrl,
          title,
          description,
          marketSegment: section.marketSegment,
          type: section.type,
          imageUrl: fullImage
        })

        found++
      })

      console.log(`${section.marketSegment} ${section.type} page ${page}: ${found}`)

      if (found === 0) break
    }
  }

  return [...products.values()]
}

function getOffersPackageText($: cheerio.CheerioAPI) {
  const values = [
    ...new Set(
      $('.offers-selector')
        .find('a, button, span, div')
        .map((_, el) => clean($(el).text()))
        .get()
        .filter(Boolean)
        .filter(value => /(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг|шт)/i.test(value))
    )
  ]

  return values.join(', ')
}

function parseCharacteristicsPairs($: cheerio.CheerioAPI) {
  const result: Record<string, string> = {}

  $('.property-name').each((_, el) => {
    const name = normalizeUkrText(clean($(el).text()))
    const value = clean(
      $(el)
        .closest('.column')
        .next('.column')
        .find('.property-value')
        .text()
    )

    if (name && value) {
      result[name] = value
    }
  })

  return result
}

function normalizeImageUrl(value?: string | null) {
  if (!value) return null

  const firstUrl = value.split(',')[0]?.trim().split(' ')[0]

  if (!firstUrl) return null

  return firstUrl.startsWith('http')
    ? firstUrl
    : `${BASE_URL}${firstUrl}`
}

function getProductImage($: cheerio.CheerioAPI) {
  return (
    normalizeImageUrl($('picture source[type="image/webp"]').first().attr('data-srcset'))
    || normalizeImageUrl($('picture source[type="image/webp"]').first().attr('srcset'))
    || normalizeImageUrl($('picture img').first().attr('data-src'))
    || normalizeImageUrl($('picture img').first().attr('src'))
    || normalizeImageUrl($('meta[property="og:image"]').attr('content'))
  )
}

async function parseProduct(item: ProductLink): Promise<ParsedProduct> {
  const html = await fetchHtml(item.url)
  const $ = cheerio.load(html)

  const tabs = $('.description-tabs-content > div')
    .map((_, el) => clean($(el).text()))
    .get()

  const characteristicsTab = normalizeUkrText(tabs[2] || '')
  const applicationFeaturesTab = tabs[3] || ''

  const h1 = clean($('h1').first().text())
  const name = normalizeName(h1 || item.title)
  const slug = makeSlug(name)

  const description =
    item.description
    || clean($('.product__description').first().text())
    || clean($('meta[name="description"]').attr('content'))
    || null

  const characteristicsPairs = parseCharacteristicsPairs($)

  const activeIngredients = parseActiveIngredients(
    characteristicsPairs['Діюча речовина'] || ''
  )

  const formulationText = characteristicsPairs['Препаративна форма'] || ''

  const offersPackageText = getOffersPackageText($)
  const titlePackage = extractPackageFromTitle(item.title)
  const packages = parsePackages(offersPackageText || titlePackage)

  const sourceImageUrl =
    getProductImage($)
    || item.imageUrl
    || null

  const contentSections = [
    {
      section_key: 'application_features',
      title: 'Особливості застосування',
      content: applicationFeaturesTab,
      sort_order: 1
    },
    {
      section_key: 'characteristics_raw',
      title: 'Характеристики',
      content: characteristicsTab,
      sort_order: 2
    }
  ].filter(section => section.content)

  return {
    name,
    slug,
    type: item.type,
    market_segment: item.marketSegment,
    description,
    source_url: item.url,
    source_image_url: sourceImageUrl,
    activeIngredients,
    formulationText,
    packages,
    contentSections
  }
}

async function saveActiveIngredient(
  productId: string,
  active: { name: string; concentration: string | null }
) {
  if (!active.name) return

  const { data: ingredient, error: ingredientError } = await supabase
    .from('active_ingredients')
    .upsert({
      name: active.name
    }, {
      onConflict: 'name'
    })
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
    const packageUnitId = await getPackageUnitId(item.unit)

    if (!packageUnitId) continue

    const { error } = await supabase
      .from('product_packages')
      .upsert({
        product_id: productId,
        amount: item.amount,
        unit: item.unit,
        label: item.label,
        package_unit_id: packageUnitId,
        sort_order: item.sort_order
      }, {
        onConflict: 'product_id,amount,package_unit_id'
      })

    if (error) throw error
  }
}

async function saveContentSections(
  productId: string,
  sections: ParsedProduct['contentSections']
) {
  await supabase
    .from('product_content_sections')
    .delete()
    .eq('product_id', productId)

  if (!sections.length) return

  const { error } = await supabase
    .from('product_content_sections')
    .insert(
      sections.map(section => ({
        product_id: productId,
        ...section
      }))
    )

  if (error) throw error
}

async function importProduct(product: ParsedProduct, manufacturerId: string) {
  const formulationTypeId = await getFormulationTypeId(product.formulationText)

  const { data: savedProduct, error } = await supabase
    .from('products')
    .upsert({
      name: product.name,
      slug: product.slug,
      type: product.type,
      manufacturer_id: manufacturerId,
      formulation_type_id: formulationTypeId,
      description: product.description,
      source_url: product.source_url,
      source_image_url: product.source_image_url,
      market_segment: product.market_segment,
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

  for (const active of product.activeIngredients) {
    await saveActiveIngredient(savedProduct.id, active)
  }

  await savePackages(savedProduct.id, product.packages)
  await saveContentSections(savedProduct.id, product.contentSections)

  console.log(`Imported UKRAVIT: ${product.name} / ${product.market_segment}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()
  const links = await collectProductLinks()

  console.log(`Found UKRAVIT links: ${links.length}`)

  for (const link of links) {
    try {
      const product = await parseProduct(link)
      await importProduct(product, manufacturerId)
    } catch (error) {
      console.error(`Failed: ${link.url}`, error)
    }
  }
}

main()
