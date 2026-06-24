import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://small.summit-agro.com.ua'

const CATEGORY_URLS = [
  {
    url: `${BASE_URL}/product-category/zahyst-vid-hvorob/`,
    defaultType: 'fungicide',
    categoryName: 'Захист від хвороб'
  },
  {
    url: `${BASE_URL}/product-category/zahyst-vid-shkidnykiv/`,
    defaultType: 'insecticide',
    categoryName: 'Захист від шкідників'
  },
  {
    url: `${BASE_URL}/product-category/kontrol-buryaniv/`,
    defaultType: 'herbicide',
    categoryName: 'Контроль бур’янів'
  },
  {
    url: `${BASE_URL}/product-category/biologichnyj-zahyst/`,
    defaultType: 'bio_product',
    categoryName: 'Біологічний захист'
  },
  {
    url: `${BASE_URL}/product-category/organichni/`,
    defaultType: 'bio_product',
    categoryName: 'Органічні'
  },
  {
    url: `${BASE_URL}/product-category/prylypachi/`,
    defaultType: 'adjuvant',
    categoryName: 'Прилипачі'
  }
]

const typeMap: Record<string, string> = {
  'гербіцид': 'herbicide',
  'фунгіцид': 'fungicide',
  'інсектицид': 'insecticide',
  'акарицид': 'acaricide',
  'ад’ювант': 'adjuvant',
  "ад'ювант": 'adjuvant',
  'прилипач': 'adjuvant',
  'добриво': 'fertilizer',
  'біопродукт': 'bio_product',
  'біофунгіцид': 'biofungicide',
  'регулятор росту': 'growth_regulator'
}

function clean(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
  return slugify(value, {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function normalizeProductName(value: string) {
  return clean(value)
    .replace(/^(гербіцид|фунгіцид|інсектицид|акарицид|ад['’ʼ]?ювант|біопродукт|біофунгіцид|протруйник|регулятор росту|очищувач обприскувача)\s*/i, '')
    .replace(/®/g, '')
    .replace(/[, ]+(РК|КС|ВП|КЕ|ВГ|РГ|SC|SL|WP|WG|EC)\s*$/i, '')
    .trim()
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
    .select('id')
    .eq('slug', 'sumi-agro')
    .single()

  if (error) throw error

  return data.id
}

function guessType(text: string) {
  const lower = text.toLowerCase()

  const found = Object.entries(typeMap).find(([label]) =>
    lower.includes(label)
  )

  return found?.[1] || null
}

function titleFromUrl(url: string) {
  const last = url
    .split('/')
    .filter(Boolean)
    .pop() || ''

  return last
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

async function collectProductLinks() {
  const links = new Map<string, {
    url: string
    title: string
    defaultType: string
    categoryName: string
  }>()

  for (const category of CATEGORY_URLS) {
    const html = await fetchHtml(category.url)
    const $ = cheerio.load(html)

    $('.product-grid-item').each((_, card) => {
      const linkEl = $(card).find('a[href*="/product/"]').first()

      const href = linkEl.attr('href')
      const title =
        clean($(card).find('.wd-entities-title').text())
        || clean(linkEl.text())

      if (!href || !title) return

      if (!href.includes('/product/')) return

      const fullUrl = href.startsWith('http')
        ? href
        : `${BASE_URL}${href}`

      links.set(fullUrl, {
        url: fullUrl,
        title,
        defaultType: category.defaultType,
        categoryName: category.categoryName
      })
    })
  }

  return [...links.values()]
}

function parseProductSections($: cheerio.CheerioAPI, categoryName: string) {
  const bodyText = clean($('body').text())

  return [
    {
      key: 'consumer_category',
      title: 'Категорія',
      content: categoryName
    },
    {
      key: 'description_raw',
      title: 'Опис',
      content: bodyText
    }
  ].filter(section => section.content)
}

async function parseProduct(item: {
  url: string
  title: string
  defaultType: string
  categoryName: string
}) {
  const html = await fetchHtml(item.url)
  const $ = cheerio.load(html)

  const h1 = clean($('h1').first().text())

  const rawName =
    h1 && h1.toLowerCase() !== 'препарати'
      ? h1
      : item.title && item.title.toLowerCase() !== 'препарати'
        ? item.title
        : titleFromUrl(item.url)

  const name = normalizeProductName(rawName)

  const image = $('img')
    .map((_, img) => $(img).attr('src'))
    .get()
    .find(src => src && !src.includes('logo'))

  const sourceImageUrl = image
    ? image.startsWith('http') ? image : `${BASE_URL}${image}`
    : null

  const description =
    clean($('.woocommerce-product-details__short-description').first().text())
    || clean($('.product-description').first().text())
    || clean($('h1').first().nextAll('p').first().text())
    || null

  const type = guessType(`${h1} ${item.title} ${$('body').text()}`) || item.defaultType

  return {
    name,
    slug: makeSlug(name),
    type,
    description,
    source_url: item.url,
    source_image_url: sourceImageUrl,
    market_segment: 'consumer',
    categoryName: item.categoryName,
    sections: parseProductSections($, item.categoryName)
  }
}

async function saveContentSections(productId: string, sections: Array<{
  key: string
  title: string
  content: string
}>) {
  await supabase
    .from('product_content_sections')
    .delete()
    .eq('product_id', productId)

  const rows = sections
    .filter(section => section.content)
    .map((section, index) => ({
      product_id: productId,
      section_key: section.key,
      title: section.title,
      content: section.content,
      sort_order: index + 1
    }))

  if (!rows.length) return

  const { error } = await supabase
    .from('product_content_sections')
    .insert(rows)

  if (error) throw error
}

async function importProduct(
  product: Awaited<ReturnType<typeof parseProduct>>,
  manufacturerId: string
) {
  const { data: savedProduct, error } = await supabase
    .from('products')
    .upsert({
      name: product.name,
      slug: product.slug,
      type: product.type,
      manufacturer_id: manufacturerId,
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

  await saveContentSections(savedProduct.id, product.sections)

  console.log(`Imported small: ${product.name}`)
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
  }

  const manufacturerId = await getManufacturerId()
  const links = await collectProductLinks()

  console.log(`Found small products: ${links.length}`)

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
