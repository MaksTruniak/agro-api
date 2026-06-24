import { chromium } from 'playwright'

const CATEGORIES = [
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Inoculants/', type: 'inoculant' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Гербіциди/', type: 'herbicide' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Інсектициди/', type: 'insecticide' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Протруйники/', type: 'seed_treatment' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Регулятори-росту/', type: 'growth_regulator' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Родентициди/', type: 'rodenticide' },
  { url: 'https://www.agro.basf.ua/uk/Products/overview/Фунгіциди/', type: 'fungicide' }
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    locale: 'uk-UA',
    userAgent: 'Mozilla/5.0'
  })

  const found = new Map<string, {
    url: string
    title: string
    type: string
    imageUrl: string | null
  }>()

  for (const category of CATEGORIES) {
    await page.goto(category.url, { waitUntil: 'networkidle' })

    const items = await page.$$eval('a[href*="/uk/Products/overview/"]', (links) => {
      return links.map((link) => {
        const a = link as HTMLAnchorElement
        const img = a.querySelector('img') as HTMLImageElement | null

        return {
          url: a.href.trim(),
          title:
            img?.alt
            || a.getAttribute('title')?.replace(/^View\s+/i, '')
            || a.textContent?.trim()
            || '',
          imageUrl: img?.src || null
        }
      })
    })

    console.log(`${category.type}: ${items.length}`)

    for (const item of items) {
      if (!item.url || !item.title) continue
      if (!item.url.includes('/uk/Products/overview/')) continue
      if (!item.url.includes('.html')) continue
      if (item.url.includes('/overview/Inoculants/') && category.type !== 'inoculant') continue
      if (item.title.length > 80) continue

      found.set(item.url, {
        ...item,
        type: category.type
      })
    }
  }

  await browser.close()

  console.log('\nTOTAL:', found.size)

  for (const item of found.values()) {
    console.log(`${item.type} | ${item.title} | ${item.url} | ${item.imageUrl || '-'}`)
  }
}

main()
