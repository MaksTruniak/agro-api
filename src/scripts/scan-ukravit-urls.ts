import 'dotenv/config'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://www.ukravit.ua'

const SECTIONS = [
  { url: `${BASE_URL}/gerbitsidi/`, type: 'herbicide', segment: 'professional' },
  { url: `${BASE_URL}/fungitsidi/`, type: 'fungicide', segment: 'professional' },
  { url: `${BASE_URL}/insektitsidi/`, type: 'insecticide', segment: 'professional' },
  { url: `${BASE_URL}/protruyniki/`, type: 'seed_treatment', segment: 'professional' },
  { url: `${BASE_URL}/mikrodobriva/`, type: 'fertilizer', segment: 'professional' },
  { url: `${BASE_URL}/aduvanti/`, type: 'adjuvant', segment: 'professional' },
  { url: `${BASE_URL}/desikanti/`, type: 'desiccant', segment: 'professional' },
  { url: `${BASE_URL}/regulyatory-rosta/`, type: 'growth_regulator', segment: 'professional' },
  { url: `${BASE_URL}/fumiganty/`, type: 'fumigant', segment: 'professional' },
  { url: `${BASE_URL}/rodentitsidi/`, type: 'rodenticide', segment: 'professional' },
  { url: `${BASE_URL}/nasinnya/`, type: 'seed', segment: 'professional' },
  { url: `${BASE_URL}/rkd/`, type: 'liquid_complex_fertilizer', segment: 'professional' },
  { url: `${BASE_URL}/inokulyanti/`, type: 'inoculant', segment: 'professional' },
  { url: `${BASE_URL}/inshi-tovari/`, type: 'other', segment: 'professional' },

  { url: `${BASE_URL}/privatniy-protruyniki/`, type: 'seed_treatment', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-gerbitsidi/`, type: 'herbicide', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-fungitsidi/`, type: 'fungicide', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-insektitsidi/`, type: 'insecticide', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-regulyatori-rostu/`, type: 'growth_regulator', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-dopomizhni-rechovini/`, type: 'adjuvant', segment: 'consumer' },
  { url: `${BASE_URL}/kompleksi-dlya-zahistu-roslin/`, type: 'bio_product', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-rodentitsidi/`, type: 'rodenticide', segment: 'consumer' },
  { url: `${BASE_URL}/privatniy-pobutovi-zasobi-zakhistu/`, type: 'disinfectant', segment: 'consumer' }
]

function clean(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

async function fetchHtml(url: string) {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status}`)
  }

  return await res.text()
}

function normalizeUrl(href: string) {
  return href.startsWith('http') ? href : `${BASE_URL}${href}`
}

function isProductUrl(url: string) {
  if (!url.startsWith(`${BASE_URL}/`)) return false
  if (url.includes('#')) return false

  const blocked = [
    'gerbitsidi',
    'fungitsidi',
    'insektitsidi',
    'protruyniki',
    'mikrodobriva',
    'aduvanti',
    'desikanti',
    'regulyatory-rosta',
    'fumiganty',
    'rodentitsidi',
    'nasinnya',
    'rkd',
    'inokulyanti',
    'inshi-tovari',
    'privatniy',
    'kompleksi-dlya-zahistu-roslin',
    'politika',
    'cookie',
    'kontakti',
    'oplata',
    'dostavka',
    'pro-kompaniyu',
    'news',
    'blog',
    'cart',
    'checkout',
    'my-account'
  ]

  const slug = url.split('/').filter(Boolean).pop() || ''

  if (!slug) return false
  if (blocked.some(item => slug.includes(item))) return false

  return /^https:\/\/www\.ukravit\.ua\/[^/]+\/?$/.test(url)
}

async function main() {
  const found = new Map<string, {
    url: string
    title: string
    type: string
    segment: string
    sectionUrl: string
  }>()

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
      let count = 0

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return

        const url = normalizeUrl(href)

        if (!isProductUrl(url)) return

        const title = clean($(el).text())
        const cardText = clean($(el).closest('article, li, div, section').text())

        const finalTitle =
          title && title.length < 80
            ? title
            : cardText.split(/\s{2,}|\n/).map(clean).filter(Boolean)[0] || ''

        if (!finalTitle || finalTitle.length > 80) return

        found.set(`${url}-${section.segment}`, {
          url,
          title: finalTitle,
          type: section.type,
          segment: section.segment,
          sectionUrl: section.url
        })

        count++
      })

      console.log(`${section.segment} ${section.type} page ${page}: ${count}`)

      if (count === 0) break
    }
  }

  console.log('\nTOTAL:', found.size)

  for (const item of found.values()) {
    console.log(`${item.segment} | ${item.type} | ${item.title} | ${item.url}`)
  }
}

main()
