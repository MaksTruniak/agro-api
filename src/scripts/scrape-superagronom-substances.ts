import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const BASE_URL = 'https://superagronom.com'
const LIST_URL = `${BASE_URL}/diyuchi-rechovini?id=343&page=`
const TOTAL_PAGES = 22

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'uk-UA,uk;q=0.9',
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function clean(v?: string | null) {
  return v?.replace(/\s+/g, ' ').trim() || ''
}

// --- Крок 1: зібрати всі URL карток ---
async function collectUrls(): Promise<string[]> {
  const urls: string[] = []
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const url = `${LIST_URL}${page}`
    console.log(`Scanning page ${page}/${TOTAL_PAGES}: ${url}`)
    const html = await fetchHtml(url)
    const $ = cheerio.load(html)
    $('a[href^="/diyuchi-rechovini/"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      // лише картки речовин (мають -id в кінці)
      if (href.match(/\/diyuchi-rechovini\/.+-id\d+$/)) {
        const full = `${BASE_URL}${href}`
        if (!urls.includes(full)) urls.push(full)
      }
    })
    await delay(300)
  }
  return urls
}

// --- Крок 2: спарсити картку речовини ---
interface Substance {
  name_uk: string
  name_latin: string | null
  slug: string
  chemical_formula: string | null
  chemical_class: string | null
  mechanism: string | null
  penetration_method: string | null
  application_method: string | null
  crops: string | null
  pest_spectrum: string | null
  hazard_class_human: string | null
  hazard_class_bees: string | null
  source_url: string
}

function extractSlug(url: string): string {
  return url.split('/').pop() || ''
}

async function parsePage(url: string): Promise<Substance | null> {
  try {
    const html = await fetchHtml(url)
    const $ = cheerio.load(html)

    const name_uk = clean($('h1').first().text())
    if (!name_uk) return null

    const slug = extractSlug(url)

    // Структура: .product__head-info-item містить два div — ключ і значення
    const fields: Record<string, string> = {}
    $('.product__head-info-item').each((_, el) => {
      const divs = $(el).find('div')
      if (divs.length >= 2) {
        const key = clean($(divs[0]).text()).toLowerCase()
        const val = clean($(divs[1]).text())
        if (key && val) fields[key] = val
      }
    })

    const get = (...keys: string[]) => {
      for (const k of keys) {
        for (const [fk, fv] of Object.entries(fields)) {
          if (fk.includes(k)) return fv
        }
      }
      return null
    }

    const name_latin = get('назва латиницею', 'latin') || null

    return {
      name_uk,
      name_latin,
      slug,
      chemical_formula: get('формула'),
      chemical_class: get('хімічний клас', 'клас'),
      mechanism: get('механізм дії', 'механізм'),
      penetration_method: get('спосіб проникнення', 'проникнення'),
      application_method: get('способи застосування', 'застосування'),
      crops: get('культури'),
      pest_spectrum: get('спектр'),
      hazard_class_human: get('небезпек', 'людина'),
      hazard_class_bees: get('бджол', 'бджіл'),
      source_url: url,
    }
  } catch (e) {
    console.error(`Failed to parse ${url}:`, e)
    return null
  }
}

// --- Крок 3: зберегти в Supabase ---
async function upsert(s: Substance) {
  // Перевіряємо чи таблиця має розширені поля або лише name/description
  const description = [
    s.name_latin ? `Латинська назва: ${s.name_latin}` : null,
    s.chemical_formula ? `Хімічна формула: ${s.chemical_formula}` : null,
    s.chemical_class ? `Хімічний клас: ${s.chemical_class}` : null,
    s.mechanism ? `Механізм дії: ${s.mechanism}` : null,
    s.crops ? `Культури: ${s.crops}` : null,
    s.pest_spectrum ? `Спектр дії: ${s.pest_spectrum}` : null,
  ].filter(Boolean).join('\n')

  const { error } = await supabase
    .from('active_ingredients')
    .upsert({
      name: s.name_uk,
      description: description || null,
    }, { onConflict: 'name' })

  if (error) console.error(`Upsert failed for "${s.name_uk}":`, error.message)
  else console.log(`  ✓ ${s.name_uk}`)
}

// --- Головний скрипт ---
async function main() {
  console.log('=== Крок 1: збираємо URL карток ===')
  const urls = await collectUrls()
  console.log(`Знайдено ${urls.length} URL\n`)

  // Зберігаємо URL у файл на випадок помилки
  const fs = await import('fs/promises')
  await fs.writeFile('/tmp/superagronom-urls.json', JSON.stringify(urls, null, 2))
  console.log('URL збережено в /tmp/superagronom-urls.json\n')

  console.log('=== Крок 2: парсимо картки та зберігаємо ===')
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    process.stdout.write(`[${i + 1}/${urls.length}] ${url.split('/').pop()} → `)
    const substance = await parsePage(url)
    if (substance) {
      await upsert(substance)
    } else {
      console.log('  ✗ пропущено')
    }
    await delay(400)
  }

  console.log('\nГотово!')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
