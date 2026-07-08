import * as cheerio from 'cheerio'

const CATEGORIES = [
  { name: 'Азотні',      slug: 'azotni',      url: 'https://superagronom.com/dobriva-azotni' },
  { name: 'Фосфорні',   slug: 'fosforni',    url: 'https://superagronom.com/dobriva-fosforni' },
  { name: 'Калійні',    slug: 'kaliyni',     url: 'https://superagronom.com/dobriva-kaliyni' },
  { name: 'Комплексні', slug: 'kompleksni',  url: 'https://superagronom.com/dobriva-kompleksni' },
  { name: 'Мікродобрива', slug: 'mikrodobriva', url: 'https://superagronom.com/dobriva-mikrodobriva' },
]

async function main() {
  for (const cat of CATEGORIES) {
    const res = await fetch(cat.url)
    const html = await res.text()
    const $ = cheerio.load(html)

    // Кількість товарів
    const total = $('body').text().match(/(\d+)\s*товар/)?.[1] || '?'
    // Остання сторінка пагінації
    const lastPage = Math.max(...$('a[href*="?page="], a[href*="&page="]').map((i, el) => {
      const m = $(el).attr('href')?.match(/page=(\d+)/)
      return m ? parseInt(m[1]) : 1
    }).get(), 1)
    // Перші 3 посилання на товари
    const links: string[] = []
    $('a[href*="-id"]').each((i, el) => {
      const href = $(el).attr('href') || ''
      if (href.includes('dobriva') && links.length < 3) links.push(href)
    })

    console.log(`${cat.name}: ~${total} товарів, сторінок: ${lastPage}`)
    console.log('  Посилання:', links.join(', '))
  }
}
main().catch(console.error)
