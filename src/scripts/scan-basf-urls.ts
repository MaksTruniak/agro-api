import * as cheerio from 'cheerio'

const BASE_URL = 'https://www.agro.basf.ua'

const CATEGORIES = [
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/Inoculants/',
    type: 'inoculant'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%93%D0%B5%D1%80%D0%B1%D1%96%D1%86%D0%B8%D0%B4%D0%B8/',
    type: 'herbicide'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%86%D0%BD%D1%81%D0%B5%D0%BA%D1%82%D0%B8%D1%86%D0%B8%D0%B4%D0%B8/',
    type: 'insecticide'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%9F%D1%80%D0%BE%D1%82%D1%80%D1%83%D0%B9%D0%BD%D0%B8%D0%BA%D0%B8/',
    type: 'seed_treatment'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%A0%D0%B5%D0%B3%D1%83%D0%BB%D1%8F%D1%82%D0%BE%D1%80%D0%B8-%D1%80%D0%BE%D1%81%D1%82%D1%83/',
    type: 'growth_regulator'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%A0%D0%BE%D0%B4%D0%B5%D0%BD%D1%82%D0%B8%D1%86%D0%B8%D0%B4%D0%B8/',
    type: 'rodenticide'
  },
  {
    url: 'https://www.agro.basf.ua/uk/Products/overview/%D0%A4%D1%83%D0%BD%D0%B3%D1%96%D1%86%D0%B8%D0%B4%D0%B8/',
    type: 'fungicide'
  }
]

function clean(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function normalizeUrl(href: string) {
  if (href.startsWith('http')) return href
  if (href.startsWith('/')) return `${BASE_URL}${href}`
  return `${BASE_URL}/${href}`
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8'
    }
  })

  if (!res.ok) {
    console.warn(`Skip ${url}: ${res.status}`)
    return ''
  }

  return await res.text()
}

function isProductUrl(url: string) {
  if (!url.startsWith(`${BASE_URL}/uk/Products/overview/`)) return false
  if (url.includes('#')) return false

  return url.endsWith('.html')
}

async function main() {
  const found = new Map<string, {
    url: string
    title: string
    type: string
    imageUrl: string | null
    categoryUrl: string
  }>()

  for (const category of CATEGORIES) {
    const html = await fetchHtml(category.url)
    if (!html) continue
    const $ = cheerio.load(html)

    console.log('has top-product:', html.includes('top-product'))
    console.log('html length:', html.length)

    let count = 0

    $('a.top-product[href]').each((_, el) => {
      const href = $(el).attr('href')
      const title =
        clean($(el).find('img').attr('alt'))
        || clean($(el).attr('title')?.replace(/^View\s+/i, ''))

      if (!href || !title) return

      const url = normalizeUrl(clean(href))

      if (!isProductUrl(url)) return

      const image =
        $(el).find('img').attr('src')
        || $(el).find('img').attr('srcset')?.split(',')[0]?.trim().split(' ')[0]
        || null

      const imageUrl = image ? normalizeUrl(clean(image)) : null

      found.set(url, {
        url,
        title,
        type: category.type,
        imageUrl,
        categoryUrl: category.url
      })

      count++
    })
    console.log(`${category.type}: ${count}`)
  }

  console.log('\nTOTAL:', found.size)

  for (const item of found.values()) {
    console.log(`${item.type} | ${item.title} | ${item.url} | ${item.imageUrl || '-'}`)
  }
}

main()
