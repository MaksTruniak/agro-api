import * as cheerio from 'cheerio'

async function main() {
const html = await fetch('https://superagronom.com/diyuchi-rechovini/tebukonazol-id17680', {
  headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'uk-UA' }
}).then(r => r.text())

const $ = cheerio.load(html)

console.log('=== H1 ===')
console.log($('h1').first().text().trim())

console.log('\n=== TABLE rows (перші 15) ===')
$('table tr').slice(0, 15).each((i, el) => {
  const cells = $(el).find('td, th').map((_, c) => $(c).text().trim()).toArray()
  if (cells.length) console.log(cells.join(' | '))
})

console.log('\n=== DL/DT/DD ===')
$('dl dt').each((j, dt) => {
  const dd = $(dt).next('dd').text().trim()
  console.log($(dt).text().trim(), '→', dd)
})

console.log('\n=== Всі унікальні class на div/p/span ===')
const classes = new Set<string>()
$('div, p, span, ul, li').each((_, el) => {
  const c = $(el).attr('class')
  if (c) c.split(' ').forEach(x => x && classes.add(x))
})
console.log([...classes].slice(0, 50).join(', '))

console.log('\n=== .product__head-info ===')
console.log($('.product__head-info').html()?.substring(0, 1000))

console.log('\n=== .product__head-content ===')
console.log($('.product__head-content').html()?.substring(0, 1000))

console.log('\n=== .content-product children tags ===')
$('.content-product').children().each((i, el) => {
  console.log(i, $(el)[0].name, $(el).attr('class'), '→', $(el).text().trim().substring(0, 80))
})
}
main()
