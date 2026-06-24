import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import slugify from 'slugify'
import { parseActiveIngredients } from '../shared/parse-active-ingredients'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE_URL = 'https://summit-agro.com.ua'

const typeMap: Record<string, string> = {
    'гербіцид': 'herbicide',
    'фунгіцид': 'fungicide',
    'інсектицид': 'insecticide',
    'акарицид': 'acaricide',
    'адʼювант': 'adjuvant',
    "ад'ювант": 'adjuvant',
    'біопродукт': 'bio_product',
    'біофунгіцид': 'biofungicide',
    'очищувач обприскувача': 'sprayer_cleaner',
    'протруйник': 'seed_treatment',
    'регулятор росту': 'growth_regulator',
    'фунгіцид біологічного походження': 'biological_fungicide'
}

const formulationMap: Record<string, string> = {
    'концентрат суспензії': 'SC',
    'гранули, що диспергуються у воді': 'WG',
    'водорозчинні гранули': 'WG',
    'змочуваний порошок': 'WP',
    'водорозчинний порошок': 'SP',
    'розчинний концентрат': 'SL',
    'концентрат емульсії': 'EC',
    'гранули': 'GR',
    'рідина': 'LIQ'
}

const unitMap: Record<string, string> = {
    мл: 'ml',
    л: 'l',
    г: 'g',
    кг: 'kg',
    шт: 'pcs'
}

type ActiveIngredient = {
    name: string
    concentration: string | null
}

type ParsedPackage = {
    label: string
    amount: number
    unitCode: string
    sortOrder: number
}

type ParsedProduct = {
    name: string
    slug: string
    type: string
    description: string
    activeIngredients: ActiveIngredient[]
    formulationText: string
    actionMethod: string
    packageText: string
    packages: ParsedPackage[]
    workingSolutionRate: string
    storageTemperature: string
    applicationRatesRaw: string
    benefits: string
    actionMechanism: string
    applicationFeatures: string
    tankMixRecommendations: string
    source_url: string
    source_image_url: string | null
}

function clean(value?: string) {
    return value?.replace(/\s+/g, ' ').trim() || ''
}

function makeSlug(value: string) {
    return slugify(value, {
        lower: true,
        strict: true,
        locale: 'uk'
    })
}

function normalizeProductName(value: string) {
    return clean(value)
        .replace(/^(гербіцид|фунгіцид|інсектицид|акарицид|ад['’ʼ]?ювант|біопродукт|біофунгіцид|протруйник|регулятор росту|очищувач обприскувача)\s*/i, '')
        .replace(/[, ]+(РК|КС|ВП|КЕ|РГ|ВГ|ЗП|КН|МД|СЕ|ЕВ|ТН|SC|SL|WP|WG|EC)\s*®?$/i, '')
        .replace(/®/g, '')
        .trim()
}

function parseBlock(text: string, start: string, endLabels: string[]) {
    const endPattern = endLabels
        .map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')

    const regex = new RegExp(
        `${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*([\\s\\S]*?)(?=${endPattern}:?|$)`,
        'i'
    )

    const match = text.match(regex)
    return clean(match?.[1])
}

function parseCharacteristics(text: string) {
    const labels = [
        'Назва препарату',
        'Тип продукту',
        'Діюча речовина',
        'Препаративна форма',
        'Спосіб дії',
        'Норма витрати робочого розчину',
        'Упаковка',
        'Температурний режим зберігання',
        'КУЛЬТУРИ ТА НОРМИ ВНЕСЕННЯ',
        'ПЕРЕВАГИ ПРЕПАРАТУ',
        'МЕХАНІЗМ ДІЇ',
        'ОСОБЛИВОСТІ ЗАСТОСУВАННЯ',
        'РЕКОМЕНДОВАНІ БАКОВІ СУМІШІ'
    ]

    const result: Record<string, string> = {}

    for (let i = 0; i < labels.length; i++) {
        const current = labels[i]
        const nextLabels = labels.slice(i + 1)

        result[current] = parseBlock(text, current, nextLabels)
    }

    return result
}

function parsePackages(value: string): ParsedPackage[] {
    return clean(value)
        .split(',')
        .map(item => item.trim())
        .map((item, index) => {
            const match = item.match(/(\d+(?:[,.]\d+)?)\s*(мл|л|г|кг|шт)/i)

            if (!match) return null

            const unitUa = match[2].toLowerCase()
            const unitCode = unitMap[unitUa]

            if (!unitCode) return null

            return {
                label: item,
                amount: Number(match[1].replace(',', '.')),
                unitCode,
                sortOrder: index + 1
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
        .select('id')
        .eq('slug', 'sumi-agro')
        .single()

    if (error) throw error
    return data.id
}

async function getFormulationTypeId(formulationText?: string) {
    if (!formulationText) return null

    const normalized = clean(formulationText).toLowerCase()
    const code = formulationMap[normalized]

    if (!code) return null

    const { data, error } = await supabase
        .from('formulation_types')
        .select('id')
        .eq('code', code)
        .single()

    if (error) return null

    return data.id
}

async function getPackageUnitId(unitCode: string) {
    const { data, error } = await supabase
        .from('package_units')
        .select('id, symbol')
        .eq('code', unitCode)
        .single()

    if (error) return null

    return data
}

async function collectProductLinks() {
    const links = new Map<string, { url: string; title: string }>()

    for (let page = 1; page <= 5; page++) {
        const url = page === 1 ? `${BASE_URL}/catalog` : `${BASE_URL}/catalog?page=${page}`
        const html = await fetchHtml(url)
        const $ = cheerio.load(html)

        $('a').each((_, el) => {
            const href = $(el).attr('href')
            const title = clean($(el).text())

            if (!href || !title) return
            if (!href.includes('/product/')) return

            const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`

            links.set(fullUrl, {
                url: fullUrl,
                title
            })
        })
    }

    return [...links.values()]
}

async function parseProduct(item: { url: string; title: string }): Promise<ParsedProduct> {
    const html = await fetchHtml(item.url)
    const $ = cheerio.load(html)

    const pageText = clean($('body').text())
    const characteristics = parseCharacteristics(pageText)

    const rawName = characteristics['Назва препарату'] || clean($('h1').first().text()) || item.title
    const productName = normalizeProductName(rawName)

    const typeLabel = clean(characteristics['Тип продукту']).toLowerCase()
    const type = typeMap[typeLabel] || 'herbicide'

    const activeIngredients = parseActiveIngredients(characteristics['Діюча речовина'] || '')

    const formulationText = characteristics['Препаративна форма'] || ''
    const packages = parsePackages(characteristics['Упаковка'] || '')

    const image = $('img')
        .map((_, img) => $(img).attr('src'))
        .get()
        .find(src => src && !src.includes('logo'))

    const sourceImageUrl = image
        ? image.startsWith('http') ? image : `${BASE_URL}${image}`
        : null

    const description = clean($('h1').first().nextAll().first().text())

    return {
        name: productName,
        slug: makeSlug(productName),
        type,
        description,
        activeIngredients,
        formulationText,
        actionMethod: characteristics['Спосіб дії'] || '',
        packageText: characteristics['Упаковка'] || '',
        packages,
        workingSolutionRate: characteristics['Норма витрати робочого розчину'] || '',
        storageTemperature: characteristics['Температурний режим зберігання'] || '',
        applicationRatesRaw: characteristics['КУЛЬТУРИ ТА НОРМИ ВНЕСЕННЯ'] || '',
        benefits: characteristics['ПЕРЕВАГИ ПРЕПАРАТУ'] || '',
        actionMechanism: characteristics['МЕХАНІЗМ ДІЇ'] || '',
        applicationFeatures: characteristics['ОСОБЛИВОСТІ ЗАСТОСУВАННЯ'] || '',
        tankMixRecommendations: characteristics['РЕКОМЕНДОВАНІ БАКОВІ СУМІШІ'] || '',
        source_url: item.url,
        source_image_url: sourceImageUrl
    }
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
    await supabase
        .from('product_packages')
        .delete()
        .eq('product_id', productId)

    for (const item of packages) {
        const unit = await getPackageUnitId(item.unitCode)

        if (!unit) continue

        const { error } = await supabase
            .from('product_packages')
            .insert({
                product_id: productId,
                amount: item.amount,
                unit: item.unitCode,
                label: item.label,
                package_unit_id: unit.id,
                sort_order: item.sortOrder
            })

        if (error) throw error
    }
}

async function saveContentSections(productId: string, product: ParsedProduct) {
    await supabase
        .from('product_content_sections')
        .delete()
        .eq('product_id', productId)

    const sections = [
        {
            section_key: 'application_rates_raw',
            title: 'Культури та норми внесення',
            content: product.applicationRatesRaw,
            sort_order: 1
        },
        {
            section_key: 'benefits',
            title: 'Переваги препарату',
            content: product.benefits,
            sort_order: 2
        },
        {
            section_key: 'action_mechanism',
            title: 'Механізм дії',
            content: product.actionMechanism,
            sort_order: 3
        },
        {
            section_key: 'application_features',
            title: 'Особливості застосування',
            content: product.applicationFeatures,
            sort_order: 4
        }
    ].filter(item => item.content)

    if (!sections.length) return

    const { error } = await supabase
        .from('product_content_sections')
        .insert(
            sections.map(item => ({
                product_id: productId,
                ...item
            }))
        )

    if (error) throw error
}

async function saveTankMixRecommendations(productId: string, content: string) {
    await supabase
        .from('product_tank_mix_recommendations')
        .delete()
        .eq('product_id', productId)

    if (!content) return

    const { error } = await supabase
        .from('product_tank_mix_recommendations')
        .insert({
            product_id: productId,
            title: 'Рекомендовані бакові суміші',
            content
        })

    if (error) throw error
}

async function importProduct(product: ParsedProduct, manufacturerId: string) {
    const formulationTypeId = await getFormulationTypeId(product.formulationText)

    const { data: savedProduct, error } = await supabase
        .from('products')
        .upsert({
            name: product.name,
            slug: product.slug,
            type: product.type,
            manufacturer_id: manufacturerId,
            formulation_type_id: formulationTypeId,
            description: product.description || null,
            source_url: product.source_url,
            source_image_url: product.source_image_url,
            action_method: product.actionMethod || null,
            working_solution_rate: product.workingSolutionRate || null,
            storage_temperature: product.storageTemperature || null,
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
    await saveContentSections(savedProduct.id, product)
    await saveTankMixRecommendations(savedProduct.id, product.tankMixRecommendations)

    console.log(`Imported: ${product.name}`)
}

async function main() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY не задані в .env')
    }

    const manufacturerId = await getManufacturerId()
    const links = await collectProductLinks()

    console.log(`Found products: ${links.length}`)

    for (const link of links) {
        try {
            const product = await parseProduct(link)
            await importProduct(product, manufacturerId)
        } catch (error) {
            console.error(`Failed: ${link.url}`, error)
        }
    }
}

main()