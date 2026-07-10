import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const BASE_URL = 'https://superagronom.com'

const CATEGORIES = [
  { slug: 'hvorobi-grib',      name: 'Гриб',     category_slug: 'grib' },
  { slug: 'hvorobi-virus',     name: 'Вірус',    category_slug: 'virus' },
  { slug: 'hvorobi-bakteriya', name: 'Бактерія', category_slug: 'bakteriya' },
]

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'uk-UA,uk;q=0.9',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeSlug(url: string): string {
  const m = url.match(/-id(\d+)$/)
  if (m) return `sa-disease-${m[1]}`
  return `sa-disease-${Date.now()}`
}

const categoryCache: Record<string, string> = {}
const productUrlCache: Record<string, string | null> = {}

async function getOrCreateCategory(name: string, slug: string): Promise<string> {
  if (categoryCache[slug]) return categoryCache[slug]
  const { data: ex } = await supabase.from('disease_categories').select('id').eq('slug', slug).single()
  if (ex) { categoryCache[slug] = ex.id; return ex.id }
  const { data } = await supabase.from('disease_categories').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
  categoryCache[slug] = data!.id
  return data!.id
}

async function findProductBySourceUrl(sourceUrl: string): Promise<string | null> {
  if (sourceUrl in productUrlCache) return productUrlCache[sourceUrl]
  const { data } = await supabase.from('products').select('id').eq('source_url', sourceUrl).single()
  productUrlCache[sourceUrl] = data?.id || null
  return productUrlCache[sourceUrl]
}

async function getProductUrls(catSlug: string): Promise<string[]> {
  const allUrls = new Set<string>()
  let page = 1
  let emptyPages = 0

  while (true) {
    const url = page === 1 ? `${BASE_URL}/${catSlug}` : `${BASE_URL}/${catSlug}?page=${page}`
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) break
    const html = await res.text()
    const $ = cheerio.load(html)

    const found: string[] = []
    $(`a[href^="/${catSlug}/"]`).each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href.match(/-id\d+$/)) {
        const full = `${BASE_URL}${href}`
        if (!allUrls.has(full)) found.push(full)
      }
    })

    if (!found.length) {
      if (++emptyPages >= 2) break
    } else {
      emptyPages = 0
      found.forEach(u => allUrls.add(u))
      console.log(`  Сторінка ${page}: +${found.length} (всього ${allUrls.size})`)
    }
    page++
    await sleep(400)
  }
  return [...allUrls]
}

async function scrapeDisease(url: string) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const html = await res.text()
  const $ = cheerio.load(html)

  const rawName = $('h1').first().text().replace(/\s+/g, ' ').trim()
  if (!rawName) return null

  const img = $('img').filter((_, el) => {
    const src = $(el).attr('src') || ''
    return src.includes('/uploads/') && !src.includes('logo') && !src.includes('brand')
  }).first().attr('src') || null
  const source_image_url = img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null

  // Поля характеристик
  const fields: Record<string, string> = {}
  $('.product__head-info-item').each((_, el) => {
    const divs = $(el).find('> div')
    const label = divs.eq(0).text().replace(/\s+/g, ' ').trim().replace(/:$/, '')
    const value = divs.eq(1).text().replace(/\s+/g, ' ').trim()
    if (label && value) fields[label] = value
  })

  // Fallback — шукаємо будь-які пари з двох дочірніх елементів
  if (!Object.keys(fields).length) {
    $('dt').each((_, el) => {
      const label = $(el).text().replace(/\s+/g, ' ').trim().replace(/:$/, '')
      const value = $(el).next('dd').text().replace(/\s+/g, ' ').trim()
      if (label && value) fields[label] = value
    })
  }

  const description = $('p').filter((_, el) => $(el).text().trim().length > 100).first().text().replace(/\s+/g, ' ').trim() || null

  // Фунгіциди/пестициди — тільки superagronom.com посилання
  const productUrls: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const absMatch = href.match(/^https?:\/\/superagronom\.com(\/pesticidi[^/]+\/.+-id\d+)$/)
    const relMatch = href.match(/^(\/pesticidi[^/]+\/.+-id\d+)$/)
    const path = absMatch?.[1] || relMatch?.[1]
    if (path) {
      const full = `${BASE_URL}${path}`
      if (!productUrls.includes(full)) productUrls.push(full)
    }
  })

  return {
    name: rawName,
    slug: makeSlug(url),
    source_url: url,
    source_image_url,
    latin_name: fields['Назва латиницею'] || fields['Латинська назва'] || null,
    culture: fields['Культура'] || null,
    pathogen: fields['Збудник'] || null,
    description,
    productUrls,
  }
}

async function findExisting(sourceUrl: string, name: string): Promise<string | null> {
  const { data: byUrl } = await supabase.from('diseases').select('id').eq('source_url', sourceUrl).single()
  if (byUrl) return byUrl.id
  const { data: byName } = await supabase.from('diseases').select('id').ilike('name', name).single()
  if (byName) {
    await supabase.from('diseases').update({ source_url: sourceUrl }).eq('id', byName.id)
    return byName.id
  }
  return null
}

async function syncProducts(diseaseId: string, productUrls: string[]): Promise<number> {
  await supabase.from('disease_products').delete().eq('disease_id', diseaseId)
  const links: { disease_id: string; product_id: string }[] = []
  for (const url of productUrls) {
    const productId = await findProductBySourceUrl(url)
    if (productId) links.push({ disease_id: diseaseId, product_id: productId })
  }
  if (links.length) await supabase.from('disease_products').insert(links)
  return links.length
}

async function main() {
  let saved = 0, existing = 0, errors = 0, productLinks = 0

  for (const cat of CATEGORIES) {
    console.log(`\n🦠 ${cat.name} (${cat.slug})`)
    const categoryId = await getOrCreateCategory(cat.name, cat.category_slug)
    const urls = await getProductUrls(cat.slug)
    console.log(`  Знайдено: ${urls.length}`)

    for (const url of urls) {
      try {
        await sleep(300)
        const disease = await scrapeDisease(url)
        if (!disease) { errors++; continue }

        const ex = await findExisting(url, disease.name)
        if (ex) {
          const n = await syncProducts(ex, disease.productUrls)
          if (n) console.log(`  ⟳ ${disease.name} → ${n} препаратів`)
          else console.log(`  ⟳ ${disease.name}`)
          productLinks += n
          existing++
          continue
        }

        const { data: saved_disease, error } = await supabase.from('diseases').insert({
          name: disease.name,
          slug: disease.slug,
          source_url: disease.source_url,
          source_image_url: disease.source_image_url,
          latin_name: disease.latin_name,
          category_id: categoryId,
          culture: disease.culture,
          pathogen: disease.pathogen,
          description: disease.description,
          is_active: true,
        }).select('id').single()

        if (error || !saved_disease) {
          console.log(`  ✗ ${disease.name}: ${error?.message}`)
          errors++
          continue
        }

        const n = await syncProducts(saved_disease.id, disease.productUrls)
        productLinks += n

        const info = [
          disease.culture ? disease.culture : '',
          disease.latin_name ? `[${disease.latin_name}]` : '',
          n ? `${n} препаратів` : '',
        ].filter(Boolean).join(' ')
        console.log(`  ✓ ${disease.name} ${info}`)
        saved++
      } catch (e: any) {
        console.log(`  ✗ ${url}: ${e.message}`)
        errors++
      }
    }
  }

  console.log(`\n✅ Готово! Збережено: ${saved}, існувало: ${existing}, помилок: ${errors}, препарат-зв'язків: ${productLinks}`)
}

main().catch(e => { console.error(e); process.exit(1) })
