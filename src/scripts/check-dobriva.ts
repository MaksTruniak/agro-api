import * as cheerio from 'cheerio'

async function main() {
  const res = await fetch('https://superagronom.com/dobriva')
  const html = await res.text()
  const $ = cheerio.load(html)

  console.log('=== КАТЕГОРІЇ ===')
  const cats = new Set<string>()
  $('a[href*="dobriva"]').each((i, el) => {
    const href = $(el).attr('href') || ''
    const text = $(el).text().trim()
    if (href.match(/\/dobriva-[a-z]/) && !href.includes('-id') && text.length > 2) {
      cats.add(`${text} -> ${href}`)
    }
  })
  cats.forEach(c => console.log(c))

  console.log('\n=== ПРИКЛАД КАРТКИ ТОВАРУ ===')
  const cardRes = await fetch('https://superagronom.com/dobriva-azotni/selitra-amiachna-id16195')
  const cardHtml = await cardRes.text()
  const $c = cheerio.load(cardHtml)

  // Спробуємо знайти поля характеристик
  $c('.product__head-info-item, .product-info__item, [class*="info-item"], [class*="char"]').each((i, el) => {
    const label = $c(el).find('div, span, dt').first().text().trim()
    const value = $c(el).find('div, span, dd').last().text().trim()
    if (label && value && label !== value) console.log(`  ${label}: ${value}`)
  })

  // Назва сторінки для перевірки
  console.log('\nTitle:', $c('h1').first().text().trim())
  console.log('HTML snippet (перші 3000 символів body):')
  console.log(cardHtml.substring(cardHtml.indexOf('<main'), cardHtml.indexOf('<main') + 3000))
}

main().catch(console.error)
