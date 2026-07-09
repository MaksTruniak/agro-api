import 'dotenv/config'
import * as cheerio from 'cheerio'
import { supabase } from '../lib/supabase'

const BASE_URL = 'https://superagronom.com'

const CATEGORIES = [
  // Зернові
  { slug: 'nasinnya-zernovi-kukurudza',       name: 'Кукурудза',         crop: 'Кукурудза' },
  { slug: 'nasinnya-zernovi-pshenicya-ozima', name: 'Пшениця озима',     crop: 'Пшениця озима' },
  { slug: 'nasinnya-zernovi-pshenicya-yara',  name: 'Пшениця яра',       crop: 'Пшениця яра' },
  { slug: 'nasinnya-zernovi-yachmin-yariy',   name: 'Ячмінь ярий',       crop: 'Ячмінь ярий' },
  { slug: 'nasinnya-zernovi-yachmin-ozimiy',  name: 'Ячмінь озимий',     crop: 'Ячмінь озимий' },
  { slug: 'nasinnya-zernovi-zhito-ozime',     name: 'Жито озиме',        crop: 'Жито озиме' },
  { slug: 'nasinnya-zernovi-oves',            name: 'Овес',              crop: 'Овес' },
  { slug: 'nasinnya-zernovi-tritikale-ozime', name: 'Тритикале озиме',   crop: 'Тритикале озиме' },
  { slug: 'nasinnya-zernovi-tritikale-yare',  name: 'Тритикале яре',     crop: 'Тритикале яре' },
  { slug: 'nasinnya-zernovi-spelta',          name: 'Спельта',           crop: 'Спельта' },
  // Олійні
  { slug: 'nasinnya-oliyni-sonyashnik',       name: 'Соняшник',          crop: 'Соняшник' },
  { slug: 'nasinnya-oliyni-ripak-ozimiy',     name: 'Ріпак озимий',      crop: 'Ріпак озимий' },
  { slug: 'nasinnya-oliyni-ripak-yariy',      name: 'Ріпак ярий',        crop: 'Ріпак ярий' },
  { slug: 'nasinnya-oliyni-garbuzi',          name: 'Гарбузи',           crop: 'Гарбузи' },
  { slug: 'nasinnya-oliyni-rizhiy',           name: 'Рижій',             crop: 'Рижій' },
  // Зернобобові
  { slug: 'nasinnya-zernobobovi-soya',        name: 'Соя',               crop: 'Соя' },
  { slug: 'nasinnya-zernobobovi-goroh',       name: 'Горох',             crop: 'Горох' },
  { slug: 'nasinnya-zernobobovi-nut',         name: 'Нут',               crop: 'Нут' },
  { slug: 'nasinnya-zernobobovi-kvasolya',    name: 'Квасоля',           crop: 'Квасоля' },
  { slug: 'nasinnya-zernobobovi-china',       name: 'Чина',              crop: 'Чина' },
  { slug: 'nasinnya-zernobobovi-sochevicya',  name: 'Сочевиця',          crop: 'Сочевиця' },
  { slug: 'nasinnya-zernobobovi-kinski-bobi', name: 'Кінські боби',      crop: 'Кінські боби' },
  // Технічні
  { slug: 'nasinnya-tehnichni-buryak-cukroviy', name: 'Буряк цукровий', crop: 'Буряк цукровий' },
  { slug: 'nasinnya-tehnichni-lon',           name: 'Льон',              crop: 'Льон' },
  { slug: 'nasinnya-tehnichni-konopli',       name: 'Коноплі',           crop: 'Коноплі' },
  { slug: 'nasinnya-tehnichni-amarant',       name: 'Амарант',           crop: 'Амарант' },
  // Крупʼяні
  { slug: 'nasinnya-krup-yani-grechka',       name: 'Гречка',            crop: 'Гречка' },
  { slug: 'nasinnya-krup-yani-proso',         name: 'Просо',             crop: 'Просо' },
  { slug: 'nasinnya-krup-yani-sorgo',         name: 'Сорго',             crop: 'Сорго' },
  { slug: 'nasinnya-krup-yani-soriz',         name: 'Сориз',             crop: 'Сориз' },
  { slug: 'nasinnya-krup-yani-ris',           name: 'Рис',               crop: 'Рис' },
  // Кормові
  { slug: 'nasinnya-kormovi-lyucerna',        name: 'Люцерна',           crop: 'Люцерна' },
  { slug: 'nasinnya-kormovi-vika',            name: 'Вика',              crop: 'Вика' },
  { slug: 'nasinnya-kormovi-lyupin',          name: 'Люпин',             crop: 'Люпин' },
  { slug: 'nasinnya-kormovi-buryak-kormoviy', name: 'Буряк кормовий',    crop: 'Буряк кормовий' },
  // Овочеві
  { slug: 'nasinnya-ovochevi-kartoplya',      name: 'Картопля',          crop: 'Картопля' },
  { slug: 'nasinnya-ovochevi-cibulya',        name: 'Цибуля',            crop: 'Цибуля' },
  { slug: 'nasinnya-ovochevi-morkva',         name: 'Морква',            crop: 'Морква' },
  { slug: 'nasinnya-ovochevi-chasnik',        name: 'Часник',            crop: 'Часник' },
  // Баштанні
  { slug: 'nasinnya-bashtanni-kavun',         name: 'Кавун',             crop: 'Кавун' },
  // Спеціальні
  { slug: 'nasinnya-specialni-girchicya',     name: 'Гірчиця',           crop: 'Гірчиця' },
  { slug: 'nasinnya-specialni-girchicya-bila',name: 'Гірчиця біла',      crop: 'Гірчиця біла' },
  { slug: 'nasinnya-specialni-sorgo',         name: 'Сорго (спец.)',     crop: 'Сорго' },
]

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'uk-UA,uk;q=0.9',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function makeSlug(name: string, url: string): string {
  const m = url.match(/-id(\d+)$/)
  if (m) return `sa-seed-${m[1]}`
  return `sa-seed-${name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80)}`
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

async function scrapeSeed(url: string, crop: string) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const html = await res.text()
  const $ = cheerio.load(html)

  const rawName = $('h1').first().text().replace(/\s+/g, ' ').trim()
  if (!rawName) return null

  // Видаляємо "від Виробника" з кінця
  const name = rawName.replace(/\s+від\s+.+$/i, '').trim()
  const slug = makeSlug(name, url)

  const img = $('.product__head-img img').attr('src') || null
  const source_image_url = img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null

  const fields: Record<string, string> = {}
  $('.product__head-info-item').each((_, el) => {
    const divs = $(el).find('> div')
    const label = divs.eq(0).text().replace(/\s+/g, ' ').trim()
    const value = divs.eq(1).text().replace(/\s+/g, ' ').trim()
    if (label && value) fields[label] = value
  })

  const manufacturer_name = fields['Виробник'] || fields['Бренд'] || null

  return {
    name,
    slug,
    source_url: url,
    source_image_url,
    crop,
    manufacturer_name,
    recommended_zone: fields['Рекомендована зона'] || null,
    maturity_group: fields['Група стиглості'] || null,
    yield_potential: fields['Потенціал врожайності, т/га'] || null,
    reg_year: fields['Рік реєстрації'] || null,
    plant_height: fields['Висота рослин, см'] || null,
    quality: fields['Якість'] || null,
    protein_content: fields['Вміст білка, %'] || null,
    grain_weight: fields['Маса 1000 зерен, г'] || null,
  }
}

// Кеш виробників
const manufacturerCache: Record<string, string | null> = {}
async function getOrCreateManufacturer(name: string): Promise<string | null> {
  if (!name) return null
  if (name in manufacturerCache) return manufacturerCache[name]
  const slug = name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80)
  const { data: ex } = await supabase.from('manufacturers').select('id').eq('slug', slug).single()
  if (ex) { manufacturerCache[name] = ex.id; return ex.id }
  const { data } = await supabase.from('manufacturers').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single()
  manufacturerCache[name] = data?.id || null
  return manufacturerCache[name]
}

async function findExisting(sourceUrl: string, name: string): Promise<string | null> {
  const { data: byUrl } = await supabase.from('products').select('id').eq('source_url', sourceUrl).single()
  if (byUrl) return byUrl.id
  const { data: byName } = await supabase.from('products').select('id').ilike('name', name).single()
  if (byName) {
    await supabase.from('products').update({ source_url: sourceUrl }).eq('id', byName.id)
    return byName.id
  }
  return null
}

async function main() {
  let saved = 0, existing = 0, errors = 0

  for (const cat of CATEGORIES) {
    console.log(`\n🌾 ${cat.name} (${cat.slug})`)
    const urls = await getProductUrls(cat.slug)
    console.log(`  Знайдено: ${urls.length}`)

    for (const url of urls) {
      try {
        await sleep(300)
        const seed = await scrapeSeed(url, cat.crop)
        if (!seed) { errors++; continue }

        const ex = await findExisting(url, seed.name)
        if (ex) { console.log(`  ⟳ ${seed.name}`); existing++; continue }

        const manufacturerId = seed.manufacturer_name
          ? await getOrCreateManufacturer(seed.manufacturer_name)
          : null

        const { data: saved_product, error } = await supabase
          .from('products')
          .insert({
            name: seed.name,
            slug: seed.slug,
            type: 'seed',
            manufacturer_id: manufacturerId,
            source_url: seed.source_url,
            source_image_url: seed.source_image_url,
            seed_crop: seed.crop,
            seed_recommended_zone: seed.recommended_zone,
            seed_maturity_group: seed.maturity_group,
            seed_yield_potential: seed.yield_potential,
            seed_reg_year: seed.reg_year,
            is_active: true,
          })
          .select('id')
          .single()

        if (error || !saved_product) {
          console.log(`  ✗ ${seed.name}: ${error?.message}`)
          errors++
          continue
        }

        console.log(`  ✓ ${seed.name}${seed.maturity_group ? ` [${seed.maturity_group}]` : ''}`)
        saved++
      } catch (e: any) {
        console.log(`  ✗ ${url}: ${e.message}`)
        errors++
      }
    }
  }

  console.log(`\n✅ Готово! Збережено: ${saved}, вже існувало: ${existing}, помилок: ${errors}`)
}

main().catch(e => { console.error(e); process.exit(1) })
