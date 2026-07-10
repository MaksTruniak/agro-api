import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const BASE_URL = 'https://superagronom.com'

const CATEGORIES = [
  { slug: 'bur-yani-malorichni',   name: 'Малорічні',   category_slug: 'malorichni' },
  { slug: 'bur-yani-bagatorichni', name: 'Багаторічні', category_slug: 'bagatorichni' },
]

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'uk-UA,uk;q=0.9',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeSlug(url: string): string {
  const m = url.match(/-id(\d+)$/)
  if (m) return `sa-weed-${m[1]}`
  return `sa-weed-${Date.now()}`
}

// Кеш категорій і класів
const categoryCache: Record<string, string> = {}
const classCache: Record<string, string> = {}
// Кеш source_url → product_id для гербіцидів
const productUrlCache: Record<string, string | null> = {}

async function getOrCreateCategory(name: string, slug: string): Promise<string> {
  if (categoryCache[slug]) return categoryCache[slug]
  const { data: ex } = await supabase.from('weed_categories').select('id').eq('slug', slug).single()
  if (ex) { categoryCache[slug] = ex.id; return ex.id }
  const { data } = await supabase.from('weed_categories').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
  categoryCache[slug] = data!.id
  return data!.id
}

async function getOrCreateClass(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '')
  if (classCache[slug]) return classCache[slug]
  const { data: ex } = await supabase.from('weed_classes').select('id').eq('slug', slug).single()
  if (ex) { classCache[slug] = ex.id; return ex.id }
  const { data } = await supabase.from('weed_classes').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
  classCache[slug] = data!.id
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

async function scrapeWeed(url: string) {
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
  $('*').filter((_, el) => {
    const children = $(el).children()
    return children.length === 2
  }).each((_, el) => {
    const divs = $(el).children()
    const label = divs.eq(0).text().replace(/\s+/g, ' ').trim().replace(/:$/, '')
    const value = divs.eq(1).text().replace(/\s+/g, ' ').trim()
    if (label && value && label.length < 60 && !label.includes('\n')) {
      fields[label] = value
    }
  })

  // Також dt/dd
  $('dt').each((_, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim().replace(/:$/, '')
    const value = $(el).next('dd').text().replace(/\s+/g, ' ').trim()
    if (label && value) fields[label] = value
  })

  const description = $('p').filter((_, el) => $(el).text().trim().length > 100).first().text().replace(/\s+/g, ' ').trim() || null

  // Гербіциди — абсолютні посилання на pesticidi-*-id*
  const herbicideUrls: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    // Абсолютні: https://superagronom.com/pesticidi-gerbicidi/name-id123
    const absMatch = href.match(/^https?:\/\/superagronom\.com(\/pesticidi[^/]+\/.+-id\d+)$/)
    // Відносні: /pesticidi-gerbicidi/name-id123
    const relMatch = href.match(/^(\/pesticidi[^/]+\/.+-id\d+)$/)
    const path = absMatch?.[1] || relMatch?.[1]
    if (path) {
      const full = `${BASE_URL}${path}`
      if (!herbicideUrls.includes(full)) herbicideUrls.push(full)
    }
  })

  return {
    name: rawName,
    slug: makeSlug(url),
    source_url: url,
    source_image_url,
    latin_name: fields['Назва латиницею'] || fields['Латинська назва'] || fields['Латинська'] || null,
    bio_class: fields['Клас'] || fields['Біологічний клас'] || null,
    family: fields['Родина'] || null,
    crops_affected: fields['Культури'] || fields['Уражені культури'] || null,
    distribution_zones: fields['Зона поширення'] || fields['Зони розповсюдження'] || null,
    feeding_method: fields['Спосіб живлення'] || null,
    description,
    herbicideUrls,
  }
}

async function findExisting(sourceUrl: string, name: string): Promise<string | null> {
  const { data: byUrl } = await supabase.from('weeds').select('id').eq('source_url', sourceUrl).single()
  if (byUrl) return byUrl.id
  const { data: byName } = await supabase.from('weeds').select('id').ilike('name', name).single()
  if (byName) {
    await supabase.from('weeds').update({ source_url: sourceUrl }).eq('id', byName.id)
    return byName.id
  }
  return null
}

async function main() {
  let saved = 0, existing = 0, errors = 0
  let herbicideLinks = 0

  for (const cat of CATEGORIES) {
    console.log(`\n🌿 ${cat.name} (${cat.slug})`)
    const categoryId = await getOrCreateCategory(cat.name, cat.category_slug)
    const urls = await getProductUrls(cat.slug)
    console.log(`  Знайдено: ${urls.length}`)

    for (const url of urls) {
      try {
        await sleep(300)
        const weed = await scrapeWeed(url)
        if (!weed) { errors++; continue }

        const ex = await findExisting(url, weed.name)
        if (ex) {
          // Якщо бур'ян вже є — все одно оновлюємо зв'язки з гербіцидами
          if (weed.herbicideUrls.length) {
            // Видаляємо старі зв'язки і вставляємо нові
            await supabase.from('weed_products').delete().eq('weed_id', ex)
            const links: { weed_id: string; product_id: string }[] = []
            for (const hUrl of weed.herbicideUrls) {
              const productId = await findProductBySourceUrl(hUrl)
              if (productId) links.push({ weed_id: ex, product_id: productId })
            }
            if (links.length) {
              await supabase.from('weed_products').insert(links)
              herbicideLinks += links.length
              console.log(`  ⟳ ${weed.name} → ${links.length} гербіцидів`)
            } else {
              console.log(`  ⟳ ${weed.name}`)
            }
          } else {
            console.log(`  ⟳ ${weed.name}`)
          }
          existing++
          continue
        }

        let classId: string | null = null
        if (weed.bio_class) {
          classId = await getOrCreateClass(weed.bio_class)
        }

        const { data: saved_weed, error } = await supabase.from('weeds').insert({
          name: weed.name,
          slug: weed.slug,
          source_url: weed.source_url,
          source_image_url: weed.source_image_url,
          latin_name: weed.latin_name,
          category_id: categoryId,
          class_id: classId,
          family: weed.family,
          crops_affected: weed.crops_affected,
          distribution_zones: weed.distribution_zones,
          feeding_method: weed.feeding_method,
          description: weed.description,
          is_active: true,
        }).select('id').single()

        if (error || !saved_weed) {
          console.log(`  ✗ ${weed.name}: ${error?.message}`)
          errors++
          continue
        }

        // Підвʼязуємо гербіциди
        if (weed.herbicideUrls.length) {
          const links: { weed_id: string; product_id: string }[] = []
          for (const hUrl of weed.herbicideUrls) {
            const productId = await findProductBySourceUrl(hUrl)
            if (productId) links.push({ weed_id: saved_weed.id, product_id: productId })
          }
          if (links.length) {
            await supabase.from('weed_products').insert(links)
            herbicideLinks += links.length
          }
        }

        const hInfo = weed.herbicideUrls.length ? ` | ${weed.herbicideUrls.length} гербіцидів` : ''
        console.log(`  ✓ ${weed.name}${weed.latin_name ? ` [${weed.latin_name}]` : ''}${hInfo}`)
        saved++
      } catch (e: any) {
        console.log(`  ✗ ${url}: ${e.message}`)
        errors++
      }
    }
  }

  console.log(`\n✅ Готово! Збережено: ${saved}, існувало: ${existing}, помилок: ${errors}, гербіцид-зв'язків: ${herbicideLinks}`)
}

main().catch(e => { console.error(e); process.exit(1) })
