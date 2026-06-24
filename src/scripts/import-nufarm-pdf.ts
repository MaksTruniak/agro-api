import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { Blob, File } from 'node:buffer'
import { ReadableStream, TransformStream } from 'node:stream/web'
import { PDFParse } from 'pdf-parse'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

if (typeof globalThis.Blob === 'undefined') {
  ;(globalThis as any).Blob = Blob
}

if (typeof globalThis.File === 'undefined') {
  ;(globalThis as any).File = File
}

if (typeof globalThis.ReadableStream === 'undefined') {
  ;(globalThis as any).ReadableStream = ReadableStream
}

if (typeof globalThis.TransformStream === 'undefined') {
  ;(globalThis as any).TransformStream = TransformStream
}

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as any).WebSocket = class WebSocket {}
}

const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PDF_PATH = process.env.NUFARM_PDF_PATH || 'data/nufarm.pdf'
const DRY_RUN = process.env.DRY_RUN === 'true'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const PRODUCTS = [
  { name: 'АГРІМАКС', page: 8, type: 'herbicide' },
  { name: 'АГРІТОКС', page: 12, type: 'herbicide' },
  { name: 'АГРІТОКС ТУРБО / ДІКОГЕРБ СУПЕР', page: 16, type: 'herbicide' },
  { name: 'АСТРАЛ', page: 18, type: 'herbicide' },
  { name: 'АСТРАЛ КОМБІ', page: 20, type: 'herbicide' },
  { name: 'БРОМІЦИД', page: 22, type: 'herbicide' },
  { name: 'ДЕКСТЕР', page: 24, type: 'herbicide' },
  { name: 'ДІКОПУР ТОП', page: 26, type: 'herbicide' },
  { name: 'ЕКВІНОКС', page: 28, type: 'herbicide' },
  { name: 'ЕСТЕТ', page: 32, type: 'herbicide' },
  { name: 'ЗЕАГРАН', page: 34, type: 'herbicide' },
  { name: 'ІНТЕРЦЕПТ', page: 36, type: 'herbicide' },
  { name: 'КВАД', page: 38, type: 'herbicide' },
  { name: 'КІДЕКА', page: 40, type: 'herbicide' },
  { name: 'КЛІНІК', page: 42, type: 'herbicide' },
  { name: 'КЛІНІК ІКСТРИМ', page: 44, type: 'herbicide' },
  { name: 'КЛІНІК МАКС', page: 46, type: 'herbicide' },
  { name: 'КЛОЗЕ', page: 48, type: 'herbicide' },
  { name: 'ЛАРС', page: 50, type: 'herbicide' },
  { name: 'ЛАРС ДЕЛЬТА', page: 52, type: 'herbicide' },
  { name: 'ЛАРС КОМБІ', page: 54, type: 'herbicide' },
  { name: 'МАРСЕЛЬ', page: 56, type: 'herbicide' },
  { name: 'МОНІТОР ПЛЮС', page: 58, type: 'herbicide' },
  { name: 'МОНТЕРО / ГЛІФОСКА', page: 60, type: 'herbicide' },
  { name: 'ТЕЙЛОР', page: 62, type: 'herbicide' },
  { name: 'ТРОЛЛЕР', page: 64, type: 'herbicide' },
  { name: 'ТРУ', page: 66, type: 'herbicide' },
  { name: 'ФІЛДЕР', page: 68, type: 'herbicide' },
  { name: 'ФЛОЙД', page: 70, type: 'herbicide' },
  { name: 'ФОРМОСА', page: 72, type: 'herbicide' },
  { name: 'АЙРІС', page: 76, type: 'fungicide' },
  { name: 'ДЖОУСТ', page: 78, type: 'fungicide' },
  { name: 'ДЖОУСТ ПРО', page: 80, type: 'fungicide' },
  { name: 'КУПРОКСАТ', page: 82, type: 'fungicide' },
  { name: 'ОРБІТ', page: 84, type: 'fungicide' },
  { name: 'ПРОТЕБ', page: 86, type: 'fungicide' },
  { name: 'СІЄСТА ЕКСТРА', page: 88, type: 'fungicide' },
  { name: 'ТЕЙЗЕР', page: 90, type: 'fungicide' },
  { name: 'ЧЕМП УЛЬТРА DP', page: 92, type: 'fungicide' },
  { name: 'ЧЕМПІОН ВГ', page: 94, type: 'fungicide' },
  { name: 'КАЙЗО', page: 98, type: 'insecticide' },
  { name: 'КАЙЗО ПРО', page: 100, type: 'insecticide' },
  { name: 'КАРНАДІН', page: 102, type: 'insecticide' },
  { name: 'НУПРІД 600', page: 106, type: 'seed_treatment' },
  { name: 'КАМПОСАН ЕКСТРА', page: 110, type: 'growth_regulator' },
  { name: 'МОКСА', page: 112, type: 'growth_regulator' },
  { name: 'СТАБІЛАН', page: 114, type: 'growth_regulator' },
  { name: 'СЕЛФІ', page: 118, type: 'adjuvant' }
] as const

const SECTION_AFTER_LAST_PAGE = 121

const formulationMap: Record<string, string> = {
  'РК': 'SL',
  'SL': 'SL',
  'КС': 'SC',
  'SC': 'SC',
  'КЕ': 'EC',
  'EC': 'EC',
  'ВГ': 'WG',
  'WG': 'WG',
  'МД': 'OD',
  'OD': 'OD',
  'СЕ': 'SE',
  'SE': 'SE',
  'ЕВ': 'EW',
  'EW': 'EW',
  'ТН': 'FS',
  'FS': 'FS'
}

const unitMap: Record<string, string> = {
  мл: 'ml',
  л: 'l',
  г: 'g',
  кг: 'kg'
}

type ParsedPackage = {
  label: string
  amount: number
  unit: string
  sort_order: number
}

type ParsedProduct = {
  name: string
  slug: string
  type: string
  page: number
  description: string | null
  activeText: string
  formulationText: string
  formulationCode: string | null
  packageText: string
  packages: ParsedPackage[]
  sections: Array<{
    section_key: string
    title: string
    content: string
    sort_order: number
  }>
}

function clean(value?: string | null) {
  return value
    ?.replace(/\u2028/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || ''
}

function cleanLine(value?: string | null) {
  return clean(value).replace(/\s+/g, ' ')
}

function cleanPdfText(value: string) {
  return cleanLine(value)
    .replace(/([А-Яа-яІіЇїЄєҐґA-Za-z])-\s+([А-Яа-яІіЇїЄєҐґA-Za-z])/g, '$1-$2')
}

function makeSlug(value: string) {
  return slugify(value.replace(/®|™|\*/g, ''), {
    lower: true,
    strict: true,
    locale: 'uk'
  })
}

function normalizeName(value: string) {
  return cleanLine(value)
    .replace(/^NEW\s*/i, '')
    .replace(/®|™|\*/g, '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePackages(value: string): ParsedPackage[] {
  const packages = cleanLine(value)
    .split(/\s*\+\s*|\s*,\s*(?=\d+\s*[xх×]\s*\d)/)
    .map(item => cleanLine(item))
    .filter(Boolean)
    .map((label, index) => {
      const match = label.match(/(?:(\d+)\s*[xх×]\s*)?(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг)/i)

      if (!match) return null

      const unit = unitMap[match[3].toLowerCase()]
      if (!unit) return null

      return {
        label,
        amount: Number(match[2].replace(',', '.')),
        unit,
        sort_order: index + 1
      }
    })
    .filter(Boolean) as ParsedPackage[]

  return [...packages.reduce((map, item) => {
    const key = `${item.amount}:${item.unit}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, item)
      return map
    }

    existing.label = `${existing.label} + ${item.label}`
    existing.sort_order = Math.min(existing.sort_order, item.sort_order)

    return map
  }, new Map<string, ParsedPackage>()).values()]
}

function getFormulationCode(value: string) {
  const text = cleanLine(value)
  const parenthesized = [...text.matchAll(/\(([A-ZА-ЯІЇЄҐ]{2,3})\)/g)]
    .map(match => match[1])
    .find(code => formulationMap[code])

  if (parenthesized) return formulationMap[parenthesized]

  const direct = Object.keys(formulationMap).find(code => new RegExp(`\\b${code}\\b`, 'i').test(text))

  return direct ? formulationMap[direct] : null
}

function isPackageLine(line: string) {
  const text = cleanLine(line)

  if (!/\d+\s*[xх×]\s*\d+(?:[,.]\d+)?\s*(?:мл|л|г|кг)/i.test(text)) {
    return false
  }

  return !/(концентрат|суспензі|гранули|емульсі|дисперсі|розчинний|soluble|suspension|emulsifiable|water dispersible|oil dispersion)/i.test(text)
}

function parseIntro(firstPageText: string, fallbackName: string) {
  const lines = clean(firstPageText)
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .filter(line => !/^\d+$/.test(line))

  const typeIndex = lines.findIndex(line =>
    ['Гербіцид', 'Фунгіцид', 'Інсектицид', 'Протруйник', 'Морфорегулятор', 'Ад’ювант', "Ад'ювант"].includes(line)
  )

  if (typeIndex === -1) {
    throw new Error(`Не знайшов тип препарату для ${fallbackName}`)
  }

  const packageIndex = lines.findIndex((line, index) => index > typeIndex && isPackageLine(line))

  if (packageIndex === -1) {
    throw new Error(`Не знайшов упаковку для ${fallbackName}`)
  }

  const nameLineIndex = lines.findIndex((line, index) =>
    index < typeIndex &&
    normalizeName(line).toLowerCase() === normalizeName(fallbackName).toLowerCase()
  )

  const descriptionStart = nameLineIndex === -1 ? 0 : nameLineIndex + 1
  const description = lines.slice(descriptionStart, typeIndex).join(' ')
  const activeText = cleanPdfText(lines.slice(typeIndex + 1, packageIndex).join(' '))
  let packageEnd = packageIndex + 1

  while (
    packageEnd < lines.length &&
    (
      lines[packageEnd - 1].endsWith('+') ||
      isPackageLine(lines[packageEnd])
    )
  ) {
    packageEnd++
  }

  const packageText = lines.slice(packageIndex, packageEnd).join(' ')
  const formulationLines = lines.slice(packageEnd)
  const formulationEnd = formulationLines.findIndex(line => line === 'ПЕРЕВАГИ')
  const formulationText = (formulationEnd === -1 ? formulationLines : formulationLines.slice(0, formulationEnd))
    .filter(line => !/^[A-Z][A-Za-z, -]+$/.test(line))
    .join(' ')

  return {
    description: description || null,
    activeText,
    packageText,
    formulationText
  }
}

function sectionContent(text: string, heading: string, nextHeadings: string[]) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const end = nextHeadings
    .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const match = clean(text).match(new RegExp(`${escaped}\\s*\\n?([\\s\\S]*?)(?=${end ? `\\n(?:${end})\\b|$` : '$'})`, 'i'))

  return clean(match?.[1])
}

function parseSections(text: string) {
  const headings = [
    'ПЕРЕВАГИ',
    'МЕХАНІЗМ ДІЇ',
    'ПОГЛИНАННЯ І ПЕРЕМІЩЕННЯ У РОСЛИНІ',
    'ОСОБЛИВОСТІ ЗАСТОСУВАННЯ',
    'ЗАСТЕРЕЖЕННЯ',
    'СВІТОВИЙ ДОСВІД ВИКОРИСТАННЯ',
    'ПЕРЕВІРЕНІ БАКОВІ СУМІШІ'
  ]

  const specs = [
    { section_key: 'benefits', title: 'Переваги', heading: 'ПЕРЕВАГИ' },
    { section_key: 'action_mechanism', title: 'Механізм дії', heading: 'МЕХАНІЗМ ДІЇ' },
    { section_key: 'plant_movement', title: 'Поглинання і переміщення у рослині', heading: 'ПОГЛИНАННЯ І ПЕРЕМІЩЕННЯ У РОСЛИНІ' },
    { section_key: 'application_features', title: 'Особливості застосування', heading: 'ОСОБЛИВОСТІ ЗАСТОСУВАННЯ' },
    { section_key: 'warnings', title: 'Застереження', heading: 'ЗАСТЕРЕЖЕННЯ' },
    { section_key: 'world_experience', title: 'Світовий досвід використання', heading: 'СВІТОВИЙ ДОСВІД ВИКОРИСТАННЯ' },
    { section_key: 'tank_mixes', title: 'Перевірені бакові суміші', heading: 'ПЕРЕВІРЕНІ БАКОВІ СУМІШІ' }
  ]

  return specs
    .map((spec, index) => ({
      section_key: spec.section_key,
      title: spec.title,
      content: sectionContent(text, spec.heading, headings.filter(item => item !== spec.heading)),
      sort_order: index + 1
    }))
    .filter(item => item.content)
}

async function extractPageTexts() {
  const parser = new PDFParse({ data: readFileSync(PDF_PATH) })
  const pages = new Map<number, string>()

  try {
    for (let page = 1; page <= SECTION_AFTER_LAST_PAGE; page++) {
      const result = await parser.getText({ partial: [page] })
      pages.set(page, clean(result.text))
    }
  } finally {
    await parser.destroy()
  }

  return pages
}

function parseProducts(pages: Map<number, string>): ParsedProduct[] {
  return PRODUCTS.map((product, index) => {
    const nextPage = PRODUCTS[index + 1]?.page || SECTION_AFTER_LAST_PAGE + 1
    const texts: string[] = []

    for (let page = product.page; page < nextPage; page++) {
      texts.push(pages.get(page) || '')
    }

    const firstPageText = pages.get(product.page) || ''
    const intro = parseIntro(firstPageText, product.name)
    const fullText = texts.join('\n')
    const name = normalizeName(product.name)

    return {
      name,
      slug: makeSlug(name),
      type: product.type,
      page: product.page,
      description: intro.description,
      activeText: intro.activeText,
      formulationText: intro.formulationText,
      formulationCode: getFormulationCode(intro.formulationText),
      packageText: intro.packageText,
      packages: parsePackages(intro.packageText),
      sections: parseSections(fullText)
    }
  })
}

async function getManufacturerId() {
  const { data, error } = await supabase
    .from('manufacturers')
    .upsert({
      name: 'Nufarm',
      slug: 'nufarm',
      country: 'Australia',
      website_url: 'https://nufarm.com/ua/'
    }, {
      onConflict: 'slug'
    })
    .select('id')
    .single()

  if (error) throw error

  return data.id
}

async function getPackageUnitId(code: string) {
  const { data } = await supabase
    .from('package_units')
    .select('id')
    .eq('code', code)
    .single()

  return data?.id || null
}

async function getFormulationTypeId(code: string | null) {
  if (!code) return null

  const { data } = await supabase
    .from('formulation_types')
    .select('id')
    .eq('code', code)
    .single()

  return data?.id || null
}

async function saveActiveIngredient(
  productId: string,
  active: { name: string; concentration: string | null }
) {
  if (!active.name) return

  const { data: ingredient, error: ingredientError } = await supabase
    .from('active_ingredients')
    .upsert({ name: active.name }, { onConflict: 'name' })
    .select('id')
    .single()

  if (ingredientError) throw ingredientError

  const { error } = await supabase
    .from('product_active_ingredients')
    .upsert({
      product_id: productId,
      active_ingredient_id: ingredient.id,
      concentration: active.concentration
    }, {
      onConflict: 'product_id,active_ingredient_id'
    })

  if (error) throw error
}

async function savePackages(productId: string, packages: ParsedPackage[]) {
  await supabase
    .from('product_packages')
    .delete()
    .eq('product_id', productId)

  for (const item of packages) {
    const unitId = await getPackageUnitId(item.unit)

    if (!unitId) continue

    const { error } = await supabase
      .from('product_packages')
      .upsert({
        product_id: productId,
        amount: item.amount,
        unit: item.unit,
        label: item.label,
        package_unit_id: unitId,
        sort_order: item.sort_order
      }, {
        onConflict: 'product_id,amount,package_unit_id'
      })

    if (error) throw error
  }
}

async function saveContentSections(productId: string, sections: ParsedProduct['sections']) {
  await supabase
    .from('product_content_sections')
    .delete()
    .eq('product_id', productId)

  if (!sections.length) return

  const { error } = await supabase
    .from('product_content_sections')
    .insert(sections.map(item => ({
      product_id: productId,
      ...item
    })))

  if (error) throw error
}

async function importProduct(product: ParsedProduct, manufacturerId: string) {
  const formulationTypeId = await getFormulationTypeId(product.formulationCode)

  const { data: savedProduct, error } = await supabase
    .from('products')
    .upsert({
      name: product.name,
      slug: product.slug,
      type: product.type,
      manufacturer_id: manufacturerId,
      formulation_type_id: formulationTypeId,
      description: product.description,
      source_url: `nufarm-catalog-2026.pdf#page=${product.page}`,
      source_image_url: null,
      market_segment: 'professional',
      is_active: true
    }, {
      onConflict: 'slug'
    })
    .select('id')
    .single()

  if (error) throw error

  await supabase
    .from('product_active_ingredients')
    .delete()
    .eq('product_id', savedProduct.id)

  for (const active of parseActiveIngredients(product.activeText)) {
    await saveActiveIngredient(savedProduct.id, active)
  }

  await savePackages(savedProduct.id, product.packages)
  await saveContentSections(savedProduct.id, product.sections)

  console.log(`Imported Nufarm PDF: ${product.name}`)
}

async function main() {
  const pages = await extractPageTexts()
  const products = parseProducts(pages)

  console.log(`Parsed Nufarm PDF products: ${products.length}`)

  for (const product of products) {
    console.log([
      product.page,
      product.type,
      product.name,
      `active="${product.activeText}"`,
      `formulation="${product.formulationText}"`,
      `packages="${product.packageText}"`,
      `sections=${product.sections.length}`
    ].join(' | '))
  }

  if (DRY_RUN) return

  const manufacturerId = await getManufacturerId()

  for (const product of products) {
    await importProduct(product, manufacturerId)
  }
}

main()
