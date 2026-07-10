import 'dotenv/config'
import * as cheerio from 'cheerio'

const url = 'https://superagronom.com/bur-yani-malorichni/zirochnik-seredniy-abo-mokrets-id16910'
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml',
}

async function main() {
  const res = await fetch(url, { headers: HEADERS })
  const html = await res.text()
  const $ = cheerio.load(html)

  console.log('=== Всі посилання на pesticidi ===')
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (href.includes('pesticidi') || href.includes('id')) {
      console.log(href)
    }
  })
}
main()
