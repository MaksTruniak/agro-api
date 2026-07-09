import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const BASE_URL = 'https://superagronom.com'

// Категорії та їх маппінг на тип продукту
const CATEGORIES = [
  { slug: 'pesticidi-gerbicidi',                        name: 'Гербіциди',         type: 'herbicide' },
  { slug: 'pesticidi-fungicidi',                        name: 'Фунгіциди',         type: 'fungicide' },
  { slug: 'pesticidi-insekticidi-i-akaricidi',          name: 'Інсектициди',       type: 'insecticide' },
  { slug: 'pesticidi-insekticidi-i-akaricidi-rodenticidi', name: 'Родентициди',   type: 'rodenticide' },
  { slug: 'pesticidi-protruyniki',                      name: 'Протруйники',       type: 'seed_treatment' },
  { slug: 'pesticidi-regulyatori-rostu',                name: 'Регулятори росту',  type: 'growth_regulator' },
  { slug: 'pesticidi-guminovi-preparati',               name: 'Гумінові препарати', type: 'bio_product' },
  { slug: 'pesticidi-mikrobni-preparati',               name: 'Мікробні препарати', type: 'bio_product' },
  { slug: 'pesticidi-poverhnevo-aktivni-rechovini',     name: 'ПАР / Ад\'юванти',  type: 'adjuvant' },
  { slug: 'pesticidi-antifidanti',                      name: 'Антифіданти',       type: 'insecticide' },
]

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeSlug(name: string, url: string): string {
  const m = url.match(/-id(\d+)$/)
  if (m) return `sa-${m[1]}`
  return `sa-${name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80)}`
}

async function getProductUrls(catSlug: string): Promise<string[]> {
  const allUrls = new Set<string>()
  let page = 1
  const catUrl = `${BASE_URL}/${catSlug}`
  let emptyPages = 0

  while (true) {
    const url = page === 1 ? catUrl : `${catUrl}?page=${page}`
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) { console.log(`  HTTP ${res.status} for ${url}`); break }
    const html = await res.text()
    const $ = cheerio.load(html)

    const found: string[] = []
    $(`a[href^="/${catSlug}/"]`).each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href.match(/-id\d+$/)) {
        const full = href.startsWith('http') ? href : `${BASE_URL}${href}`
        if (!allUrls.has(full)) found.push(full)
      }
    })

    if (!found.length) {
      emptyPages++
      if (emptyPages >= 2) break
    } else {
      emptyPages = 0
      found.forEach(u => allUrls.add(u))
      console.log(`  Сторінка ${page}: +${found.length} посилань (всього ${allUrls.size})`)
    }

    page++
    await sleep(400)
  }

  return [...allUrls]
}

// Маппінг кодів препаративних форм → formulation_types.code
const FORMULATION_CODE_MAP: Record<string, string> = {
  'ВГ': 'WG', 'WG': 'WG',
  'ЕВ': 'EW', 'EW': 'EW',
  'КЕ': 'EC', 'EC': 'EC',
  'КС': 'SC', 'SC': 'SC',
  'МД': 'OD', 'OD': 'OD',
  'МЕ': 'ME', 'ME': 'ME',
  'МС': 'OF', 'OF': 'OF',
  'РК': 'SL', 'SL': 'SL',
  'СЕ': 'SE', 'SE': 'SE',
  'СК': 'CS', 'CS': 'CS',
  'ТН': 'FS', 'FS': 'FS',
  'ФК': 'SC+CS',
  'В.С.': 'SL', 'В.С': 'SL', 'в.с.': 'SL',
  'ТА.БЛ.': 'WG', // таблетки
  'П': 'WP', // порошок
  'WP': 'WP',
  'GR': 'GR', 'ГР': 'GR',
}

// Кеш formulation_type_id
const formulationCache: Record<string, string | null> = {}

async function getFormulationTypeId(rawForm: string): Promise<string | null> {
  if (!rawForm) return null
  const upper = rawForm.trim().toUpperCase()
  const code = FORMULATION_CODE_MAP[upper] || FORMULATION_CODE_MAP[rawForm.trim()] || null
  if (!code) return null

  if (code in formulationCache) return formulationCache[code]

  const { data } = await supabase
    .from('formulation_types')
    .select('id')
    .eq('code', code)
    .single()

  formulationCache[code] = data?.id || null
  return formulationCache[code]
}

interface ScrapedProduct {
  name: string
  slug: string
  type: string
  source_url: string
  source_image_url: string | null
  active_ingredients_raw: string[] // масив назв
  formulation_form_raw: string | null
  concentration: string | null
  chem_class: string | null
  manufacturer_name: string | null
}

async function scrapeProduct(url: string): Promise<ScrapedProduct | null> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const html = await res.text()
  const $ = cheerio.load(html)

  const rawName = $('h1').first().text().replace(/\s+/g, ' ').trim()
  if (!rawName) return null

  // Видаляємо "(Виробник)" з кінця назви
  const name = rawName.replace(/\s*\([^)]+\)\s*$/, '').trim()
  const slug = makeSlug(name, url)

  const img = $('.product__head-img img').attr('src') || $('img[alt]').first().attr('src') || null
  const source_image_url = img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null

  const fields: Record<string, string> = {}
  $('.product__head-info-item').each((_, el) => {
    const divs = $(el).find('> div')
    const label = divs.eq(0).text().replace(/\s+/g, ' ').trim()
    const value = divs.eq(1).text().replace(/\s+/g, ' ').trim()
    if (label && value) fields[label] = value
  })

  // Заявник — це бренд/виробник
  const manufacturerMatch = rawName.match(/\(([^)]+)\)\s*$/)
  const manufacturer_name = fields['Заявник'] || manufacturerMatch?.[1] || null

  // Діючі речовини — через кому або " + "
  const aiRaw = fields['Діюча речовина'] || ''
  const active_ingredients_raw = aiRaw
    ? aiRaw.split(/\s*[,+]\s*/).map(s => s.trim()).filter(s => s.length > 1)
    : []

  return {
    name,
    slug,
    type: '',
    source_url: url,
    source_image_url,
    active_ingredients_raw,
    formulation_form_raw: fields['Препаративна форма'] || null,
    concentration: fields['Концентрація діючої речовини'] || null,
    chem_class: fields['Хімічний клас'] || null,
    manufacturer_name,
  }
}

async function getOrCreateManufacturer(name: string): Promise<string | null> {
  if (!name) return null
  const slug = name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80)

  const { data: existing } = await supabase
    .from('manufacturers')
    .select('id')
    .eq('slug', slug)
    .single()

  if (existing) return existing.id

  const { data, error } = await supabase
    .from('manufacturers')
    .upsert({ name, slug }, { onConflict: 'slug' })
    .select('id')
    .single()

  if (error) { console.log(`  ⚠️  Виробник "${name}": ${error.message}`); return null }
  return data?.id || null
}

async function getOrCreateActiveIngredient(name: string): Promise<string | null> {
  if (!name || name.length < 2) return null
  const slug = name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 120)

  const { data: existing } = await supabase
    .from('active_ingredients')
    .select('id')
    .eq('slug', slug)
    .single()

  if (existing) return existing.id

  const { data, error } = await supabase
    .from('active_ingredients')
    .upsert({ name_uk: name, slug }, { onConflict: 'slug' })
    .select('id')
    .single()

  if (error) return null
  return data?.id || null
}

// Перевіряємо чи вже є продукт — по source_url або по назві (ilike)
async function findExistingProduct(sourceUrl: string, name: string): Promise<string | null> {
  // 1. По source_url — точний збіг (повторний запуск скрипта)
  const { data: byUrl } = await supabase
    .from('products')
    .select('id')
    .eq('source_url', sourceUrl)
    .single()
  if (byUrl) return byUrl.id

  // 2. По назві (ilike) — продукти з інших імпортів (Syngenta, BASF тощо)
  const { data: byName } = await supabase
    .from('products')
    .select('id')
    .ilike('name', name)
    .single()
  if (byName) {
    // Допишемо source_url щоб наступний раз знайшло по url
    await supabase.from('products').update({ source_url: sourceUrl }).eq('id', byName.id)
    return byName.id
  }

  return null
}

async function main() {
  let totalSaved = 0
  let totalSkipped = 0
  let totalExisting = 0

  for (const cat of CATEGORIES) {
    console.log(`\n📦 Категорія: ${cat.name} (${cat.slug})`)
    const urls = await getProductUrls(cat.slug)
    console.log(`  Знайдено ${urls.length} товарів`)

    for (const url of urls) {
      try {
        await sleep(300)
        const product = await scrapeProduct(url)
        if (!product) { totalSkipped++; continue }

        product.type = cat.type

        // Перевіряємо дубль по source_url або назві
        const existingId = await findExistingProduct(url, product.name)
        if (existingId) {
          console.log(`  ⟳ вже є: ${product.name}`)
          totalExisting++
          continue
        }

        // Виробник (Заявник)
        const manufacturerId = product.manufacturer_name
          ? await getOrCreateManufacturer(product.manufacturer_name)
          : null

        // Препаративна форма → formulation_type_id
        const formulationTypeId = product.formulation_form_raw
          ? await getFormulationTypeId(product.formulation_form_raw)
          : null

        // Зберігаємо продукт (insert — дублі вже відсіяні вище)
        const { data: savedProduct, error } = await supabase
          .from('products')
          .insert({
            name: product.name,
            slug: product.slug,
            type: product.type,
            manufacturer_id: manufacturerId,
            formulation_type_id: formulationTypeId,
            chem_class: product.chem_class,
            source_url: product.source_url,
            source_image_url: product.source_image_url,
            is_active: true,
          })
          .select('id')
          .single()

        if (error || !savedProduct) {
          console.log(`  ✗ ${product.name}: ${error?.message}`)
          totalSkipped++
          continue
        }

        // Діючі речовини (через кому)
        for (const aiName of product.active_ingredients_raw) {
          const aiId = await getOrCreateActiveIngredient(aiName)
          if (aiId) {
            await supabase
              .from('product_active_ingredients')
              .upsert({
                product_id: savedProduct.id,
                active_ingredient_id: aiId,
                concentration: product.active_ingredients_raw.length === 1 ? product.concentration : null,
              }, { onConflict: 'product_id,active_ingredient_id' })
          }
        }

        console.log(`  ✓ ${product.name}${product.chem_class ? ` [${product.chem_class}]` : ''}`)
        totalSaved++
      } catch (e: any) {
        console.log(`  ✗ ${url}: ${e.message}`)
        totalSkipped++
      }
    }
  }

  console.log(`\n✅ Готово! Збережено: ${totalSaved}, вже існувало: ${totalExisting}, помилок: ${totalSkipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
