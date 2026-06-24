import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://store.syngenta.ua'

const CATEGORIES = [
    { url: '/small-pack-insekticidi', type: 'insecticide', segment: 'consumer' },
    { url: '/small-pack-gerbicidi', type: 'herbicide', segment: 'consumer' },
    { url: '/small-pack-fungicidi', type: 'fungicide', segment: 'consumer' },
    { url: '/small-pack-organichne-dobrivo', type: 'fertilizer', segment: 'consumer' },
    { url: '/small-pack-aduvanti', type: 'adjuvant', segment: 'consumer' },
    { url: '/small-pack-protrujniki', type: 'seed_treatment', segment: 'consumer' },

    { url: '/insekticidi', type: 'insecticide', segment: 'professional' },
    { url: '/gerbicidi', type: 'herbicide', segment: 'professional' },
    { url: '/fungicidi', type: 'fungicide', segment: 'professional' },
    { url: '/biofungicidi', type: 'biofungicide', segment: 'professional' },
    { url: '/retardanti', type: 'retardant', segment: 'professional' },
    { url: '/biopreparati', type: 'bio_product', segment: 'professional' },
    { url: '/protrujniki', type: 'seed_treatment', segment: 'professional' },
    { url: '/rodenticidi', type: 'rodenticide', segment: 'professional' }
]

type ParsedPackage = {
    label: string
    amount: number
    unit: string
    sort_order: number
}

type ActiveIngredient = {
    name: string
    concentration: string | null
}

type ParsedProduct = {
    name: string
    slug: string
    type: string
    market_segment: string
    activeIngredients: ActiveIngredient[]
    price: number | null
    packages: ParsedPackage[]
    source_url: string
    source_image_url: string | null
    description: string | null
}

function clean(value?: string) {
    return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
    return slugify(value.replace(/®/g, ''), {
        lower: true,
        strict: true,
        locale: 'uk'
    })
}

function normalizeName(value: string) {
    return clean(value)
        .replace(/®/g, '')
        .replace(/^ТОП\s+/i, '')
        .replace(/^Новинка\s+/i, '')
        .replace(/^Сортування\s+А-Я\s+А-Я\s+Я-А\s+Дешевші\s+Дорожчі\s+/i, '')
        .replace(/[, ]+(РК|КС|ВП|КЕ|ВГ|РГ|SC|SL|WP|WG|EC)$/i, '')
        .trim()
}

function parsePrice(value: string) {
    const match = value
        .replace(/\s/g, '')
        .replace('₴', '')
        .match(/(\d+(?:[,.]\d+)?)/)

    return match ? Number(match[1].replace(',', '.')) : null
}

function parsePackages(value: string): ParsedPackage[] {
    return clean(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map((label, index) => {
            const match = label.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг)/i)

            if (!match) return null

            const unitUa = match[2].toLowerCase()

            const unitMap: Record<string, string> = {
                мл: 'ml',
                л: 'l',
                г: 'g',
                кг: 'kg'
            }

            const unit = unitMap[unitUa]

            if (!unit) return null

            return {
                label,
                amount: Number(match[1].replace(',', '.')),
                unit,
                sort_order: index + 1
            }
        })
        .filter(Boolean) as ParsedPackage[]
}

async function fetchHtml(url: string) {
    const res = await fetch(url)

    if (!res.ok) {
        throw new Error(`Failed ${url}: ${res.status}`)
    }

    return await res.text()
}

async function getManufacturerId() {
    const { data, error } = await supabase
        .from('manufacturers')
        .upsert({
            name: 'Syngenta',
            slug: 'syngenta',
            country: 'Switzerland',
            website_url: 'https://www.syngenta.ua'
        }, {
            onConflict: 'slug'
        })
        .select('id')
        .single()

    if (error) throw error

    return data.id
}

async function getPackageUnitId(code: string) {
    const { data, error } = await supabase
        .from('package_units')
        .select('id')
        .eq('code', code)
        .single()

    if (error) return null

    return data.id
}

async function collectProducts(): Promise<ParsedProduct[]> {
    const products = new Map<string, ParsedProduct>()

    for (const category of CATEGORIES) {
        const html = await fetchHtml(`${BASE_URL}${category.url}`)
        const $ = cheerio.load(html)

        let count = 0

        $('.catalog-products__item').each((_, card) => {
            const title = clean($(card).find('.product__title').first().text())
            const desc = clean($(card).find('.product__desc').first().text())
            const activeText = clean($(card).find('.product__text a').first().text())
            const priceText = clean($(card).find('.product__basket_sum').first().text())
            const packagingText = clean($(card).find('.product__packaging-info').first().text())

            const href = $(card).find('.product__img').attr('href')
            const img = $(card).find('.product__img img').attr('src')

            if (!title || !href) return

            const name = normalizeName(title)

            if (!name || name.toLowerCase().includes('сортування')) return

            const slug = makeSlug(name)

            const sourceUrl = href.startsWith('http')
                ? href
                : `${BASE_URL}${href}`

            const sourceImageUrl = img
                ? img.startsWith('http')
                    ? img
                    : `${BASE_URL}${img}`
                : null

            const packages = parsePackages(packagingText)
            const activeIngredients = parseActiveIngredients(activeText)

            products.set(`${slug}-${category.segment}`, {
                name,
                slug,
                type: category.type,
                market_segment: category.segment,
                activeIngredients,
                price: parsePrice(priceText),
                packages,
                source_url: sourceUrl,
                source_image_url: sourceImageUrl,
                description: desc || null
            })

            count++
        })

        console.log(`${category.url}: ${count}`)
    }

    return [...products.values()]
}

async function saveActiveIngredient(
    productId: string,
    active: ActiveIngredient
) {
    if (!active.name) return

    const { data: ingredient, error: ingredientError } = await supabase
        .from('active_ingredients')
        .upsert({
            name: active.name
        }, {
            onConflict: 'name'
        })
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
    for (const item of packages) {
        const packageUnitId = await getPackageUnitId(item.unit)

        if (!packageUnitId) continue

        const { error } = await supabase
            .from('product_packages')
            .upsert({
                product_id: productId,
                amount: item.amount,
                unit: item.unit,
                label: item.label,
                package_unit_id: packageUnitId,
                sort_order: item.sort_order
            }, {
                onConflict: 'product_id,amount,package_unit_id'
            })

        if (error) throw error
    }
}

async function importProduct(product: ParsedProduct, manufacturerId: string) {
    const { data: savedProduct, error } = await supabase
        .from('products')
        .upsert({
            name: product.name,
            slug: product.slug,
            type: product.type,
            manufacturer_id: manufacturerId,
            market_segment: product.market_segment,
            source_url: product.source_url,
            source_image_url: product.source_image_url,
            description: product.description,
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

    for (const active of product.activeIngredients) {
        await saveActiveIngredient(savedProduct.id, active)
    }

    await savePackages(savedProduct.id, product.packages)

    console.log(`Imported Syngenta: ${product.name} / ${product.market_segment}`)
}

async function main() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
    }

    const manufacturerId = await getManufacturerId()
    const products = await collectProducts()

    console.log(`Found Syngenta products: ${products.length}`)

    for (const product of products) {
        try {
            await importProduct(product, manufacturerId)
        } catch (error) {
            console.error(`Failed ${product.name}`, error)
        }
    }
}

main()