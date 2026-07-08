import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const CATEGORIES = [
  { name: 'Азотні',        slug: 'azotni',       url: 'https://superagronom.com/dobriva-azotni' },
  { name: 'Фосфорні',      slug: 'fosforni',     url: 'https://superagronom.com/dobriva-fosforni' },
  { name: 'Калійні',       slug: 'kaliyni',      url: 'https://superagronom.com/dobriva-kaliyni' },
  { name: 'Комплексні',    slug: 'kompleksni',   url: 'https://superagronom.com/dobriva-kompleksni' },
  { name: 'Мікродобрива',  slug: 'mikrodobriva', url: 'https://superagronom.com/dobriva-mikrodobriva' },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeSlug(name: string, url: string): string {
  const m = url.match(/-id(\d+)$/)
  if (m) return m[1]
  return name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '')
}

async function getProductUrls(catUrl: string, catSlug: string): Promise<string[]> {
  const urls: string[] = []
  let page = 1
  while (true) {
    const url = page === 1 ? catUrl : `${catUrl}?page=${page}`
    const res = await fetch(url)
    const html = await res.text()
    const $ = cheerio.load(html)

    const found: string[] = []
    $('a[href*="-id"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href.includes(`dobriva-${catSlug}`) || href.includes('/dobriva-') && href.includes('-id')) {
        const full = href.startsWith('http') ? href : `https://superagronom.com${href}`
        if (!urls.includes(full)) found.push(full)
      }
    })

    if (!found.length) break
    urls.push(...found)
    console.log(`  Сторінка ${page}: +${found.length} посилань`)

    const hasNext = $(`a[href*="page=${page + 1}"]`).length > 0
    if (!hasNext) break
    page++
    await sleep(500)
  }
  return [...new Set(urls)]
}

async function scrapeProduct(url: string): Promise<Record<string, string>> {
  const res = await fetch(url)
  const html = await res.text()
  const $ = cheerio.load(html)

  const name = $('h1').first().text().trim()
  const fields: Record<string, string> = { name, source_url: url }

  // Зображення
  const img = $('.product__head-img img').attr('src') || $('img[alt]').first().attr('src') || ''
  if (img) fields.source_image_url = img.startsWith('http') ? img : `https://superagronom.com${img}`

  // Характеристики
  $('.product__head-info-item').each((_, el) => {
    const divs = $(el).find('> div')
    const label = divs.eq(0).text().trim().replace(/\s+/g, ' ')
    const value = divs.eq(1).text().trim().replace(/\s+/g, ' ')
    if (label && value) fields[label] = value
  })

  return fields
}

async function main() {
  // Завантажуємо категорії з БД
  const { data: cats } = await supabase.from('fertilizer_categories').select('id, slug')
  const catMap: Record<string, string> = Object.fromEntries((cats || []).map((c: any) => [c.slug, c.id]))

  let totalSaved = 0
  let totalSkipped = 0

  for (const cat of CATEGORIES) {
    console.log(`\n📦 Категорія: ${cat.name}`)
    const catId = catMap[cat.slug]
    if (!catId) { console.log(`  ⚠️  Категорію не знайдено в БД: ${cat.slug}`); continue }

    const urls = await getProductUrls(cat.url, cat.slug)
    console.log(`  Знайдено ${urls.length} товарів`)

    for (const url of urls) {
      try {
        await sleep(300)
        const fields = await scrapeProduct(url)
        if (!fields.name) { console.log(`  ⚠️  Без назви: ${url}`); continue }

        const slug = makeSlug(fields.name, url)

        const { error } = await supabase.from('fertilizers').upsert({
          name: fields.name,
          slug,
          category_slug:   cat.slug,
          formula:         fields['Формулa'] || fields['Формула'] || null,
          composition:     fields['Склaд'] || fields['Склад'] || null,
          mass_fraction:   fields['Мaсовa чaсткa'] || fields['Масова частка'] || null,
          fertilizer_form: fields['Формa добрив'] || fields['Форма добрив'] || null,
          fertilizer_type: fields['Тип добрива'] || null,
          manufacturer:    fields['Виробник'] || fields['Бренд'] || null,
          source_url:      fields.source_url,
          source_image_url: fields.source_image_url || null,
          is_active: true,
        }, { onConflict: 'slug' })

        if (error) { console.log(`  ✗ ${fields.name}: ${error.message}`); totalSkipped++ }
        else { console.log(`  ✓ ${fields.name}`); totalSaved++ }
      } catch (e: any) {
        console.log(`  ✗ ${url}: ${e.message}`)
        totalSkipped++
      }
    }
  }

  console.log(`\n✅ Готово! Збережено: ${totalSaved}, пропущено: ${totalSkipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
