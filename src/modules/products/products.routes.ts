import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { isValidActiveIngredientName } from '../../shared/parse-active-ingredients'
import { createActiveIngredientSlug } from '../active-ingredients/slug'
import { requireApiKey } from '../auth/api-key'

type SingleOrArray<T> = T | T[] | null | undefined

type ManufacturerRecord = {
    name: string | null
    slug: string | null
}

type FormulationTypeRecord = {
    code: string | null
    name: string | null
}

type ActiveIngredientRecord = {
    id: string | null
    name: string | null
}

type ProductActiveIngredientRecord = {
    active_ingredient_id?: string | null
    concentration: string | number | null
    active_ingredients: SingleOrArray<ActiveIngredientRecord>
}

type ProductAnalogCandidate = {
    id?: string | null
    name?: string | null
    slug?: string | null
    type?: string | null
    manufacturer?: string | null
    match_type?: string | null
    score?: number | string | null
    reason?: string | null
    matched_active_ingredients?: string[] | null
}

type ProductAnalogRecord = {
    id: string
    name: string
    slug: string
    type: string | null
    source_image_url: string | null
    market_segment: string | null
    manufacturers: SingleOrArray<ManufacturerRecord>
    formulation_types: SingleOrArray<FormulationTypeRecord>
    product_active_ingredients: ProductActiveIngredientRecord[] | null
}

type ProductActiveIngredient = {
    id: string | null
    name: string
    slug: string
    concentration: string | number | null
}

function firstRelation<T>(value: SingleOrArray<T>) {
    if (Array.isArray(value)) {
        return value[0] || null
    }

    return value || null
}

function normalizeScore(value: ProductAnalogCandidate['score'], fallbackScore: number) {
    const score = Number(value)

    if (!Number.isFinite(score)) {
        return fallbackScore
    }

    const normalizedScore = score > 0 && score <= 1
        ? score * 100
        : score

    return Math.max(0, Math.min(Math.round(normalizedScore), 100))
}

function createActiveMatchScore(sourceCount: number, matchedCount: number, extraCount: number) {
    if (!sourceCount || !matchedCount) {
        return 0
    }

    if (matchedCount === sourceCount && extraCount === 0) {
        return 100
    }

    if (matchedCount === sourceCount) {
        return Math.max(80, 95 - extraCount * 5)
    }

    const baseScore = Math.round((matchedCount / sourceCount) * 75)
    const extraPenalty = Math.min(extraCount * 5, 25)

    return Math.max(10, baseScore - extraPenalty)
}

function toActiveIngredients(items: ProductActiveIngredientRecord[] | null | undefined) {
    return (items || [])
        .map((item): ProductActiveIngredient | null => {
            const activeIngredient = firstRelation(item.active_ingredients)

            if (!activeIngredient?.name || !isValidActiveIngredientName(activeIngredient.name)) {
                return null
            }

            return {
                id: activeIngredient.id || item.active_ingredient_id || null,
                name: activeIngredient.name,
                slug: createActiveIngredientSlug(activeIngredient.name),
                concentration: item.concentration
            }
        })
        .filter((item): item is ProductActiveIngredient => Boolean(item))
}

function ingredientKey(item: ProductActiveIngredient) {
    return item.id || item.name.toLocaleLowerCase('uk')
}

function compareIngredientSets(
    sourceIngredients: ProductActiveIngredient[],
    analogIngredients: ProductActiveIngredient[]
) {
    const sourceKeys = new Set(sourceIngredients.map(ingredientKey))
    const analogKeys = new Set(analogIngredients.map(ingredientKey))

    const matched = analogIngredients.filter(item => sourceKeys.has(ingredientKey(item)))
    const missing = sourceIngredients.filter(item => !analogKeys.has(ingredientKey(item)))
    const extra = analogIngredients.filter(item => !sourceKeys.has(ingredientKey(item)))

    return {
        matched,
        missing,
        extra
    }
}

function createMatchType(
    candidate: ProductAnalogCandidate,
    sourceCount: number,
    matchedCount: number,
    missingCount: number,
    extraCount: number
) {
    if (!sourceCount) {
        return 'data_quality_fallback'
    }

    if (candidate.match_type) {
        return candidate.match_type
    }

    if (sourceCount > 0 && matchedCount === sourceCount && missingCount === 0 && extraCount === 0) {
        return 'exact_active_set'
    }

    if (sourceCount > 0 && matchedCount === sourceCount && missingCount === 0) {
        return 'contains_active_set'
    }

    if (matchedCount > 0) {
        return 'same_active'
    }

    return 'similar'
}

function createMatchReason(
    candidate: ProductAnalogCandidate,
    sourceCount: number,
    matchedCount: number,
    missingCount: number,
    extraCount: number
) {
    if (!sourceCount) {
        return 'Дані діючих речовин потребують уточнення'
    }

    if (sourceCount > 0 && matchedCount === sourceCount && missingCount === 0 && extraCount === 0) {
        return 'Повний збіг діючих речовин'
    }

    if (sourceCount > 0 && matchedCount === sourceCount && missingCount === 0) {
        return `Містить усі ${sourceCount} діючі речовини базового препарату`
    }

    if (sourceCount > 0 && matchedCount > 0) {
        return `Збігається ${matchedCount} з ${sourceCount} діючих речовин`
    }

    return candidate.reason || 'Подібний препарат'
}

export async function productsRoutes(app: FastifyInstance) {
    app.get('/v1/products/:slug', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const { data, error } = await supabase
            .from('products')
            .select(`
        id,
        name,
        slug,
        type,
        description,
        source_url,
        source_image_url,
        market_segment,
        manufacturers (
          name,
          slug
        ),
        formulation_types (
          code,
          name
        ),
        product_packages (
          label,
          amount,
          unit,
          sort_order
        ),
        product_active_ingredients (
          concentration,
          active_ingredients (
            id,
            name
          )
        ),
        product_content_sections (
          section_key,
          title,
          content,
          sort_order
        )
      `)
            .eq('slug', slug)
            .single()

        if (error || !data) {
            return reply.code(404).send({
                error: 'Product not found'
            })
        }

        const product = {
            id: data.id,
            name: data.name,
            slug: data.slug,
            type: data.type,
            description: data.description,
            source_url: data.source_url,
            source_image_url: data.source_image_url,
            market_segment: data.market_segment,
            manufacturer: data.manufacturers,
            formulation_type: data.formulation_types,

            active_ingredients: toActiveIngredients(data.product_active_ingredients),

            packages: data.product_packages?.sort((a: any, b: any) => a.sort_order - b.sort_order) || [],

            content_sections: data.product_content_sections?.sort((a: any, b: any) => a.sort_order - b.sort_order) || []
        }

        return { product }
    })

    app.get('/v1/products/:slug/analogs', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const { data: sourceProduct, error: sourceProductError } = await supabase
            .from('products')
            .select(`
        id,
        slug,
        product_active_ingredients (
          active_ingredient_id,
          concentration,
          active_ingredients (
            id,
            name
          )
        )
      `)
            .eq('slug', slug)
            .single()

        if (sourceProductError || !sourceProduct) {
            return reply.code(404).send({
                error: 'Product not found'
            })
        }

        const sourceIngredients = toActiveIngredients(sourceProduct.product_active_ingredients)

        const { data, error } = await supabase.rpc('get_product_analogs', {
            product_slug: slug
        })

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        const candidates = Array.isArray(data)
            ? data as ProductAnalogCandidate[]
            : []

        const candidateSlugs = [...new Set(candidates
            .map(item => item.slug)
            .filter((item): item is string => Boolean(item && item !== slug)))]

        if (!candidateSlugs.length) {
            return {
                analogs: []
            }
        }

        const { data: products, error: productsError } = await supabase
            .from('products')
            .select(`
        id,
        name,
        slug,
        type,
        source_image_url,
        market_segment,
        manufacturers (
          name,
          slug
        ),
        formulation_types (
          code,
          name
        ),
        product_active_ingredients (
          active_ingredient_id,
          concentration,
          active_ingredients (
            id,
            name
          )
        )
      `)
            .eq('is_active', true)
            .in('slug', candidateSlugs)

        if (productsError) {
            return reply.code(500).send({
                error: productsError.message
            })
        }

        const productsBySlug = new Map(
            ((products || []) as ProductAnalogRecord[]).map(product => [product.slug, product])
        )

        const analogs = candidates
            .map((candidate) => {
                if (!candidate.slug || candidate.slug === slug) {
                    return null
                }

                const product = productsBySlug.get(candidate.slug)

                if (!product) {
                    return null
                }

                const manufacturer = firstRelation(product.manufacturers)
                const formulationType = firstRelation(product.formulation_types)
                const activeIngredients = toActiveIngredients(product.product_active_ingredients)
                const match = compareIngredientSets(sourceIngredients, activeIngredients)
                const matchedActiveIngredientNames = match.matched.map(item => item.name)
                const sourceCount = sourceIngredients.length
                const matchedCount = match.matched.length
                const missingCount = match.missing.length
                const extraCount = match.extra.length
                const activeMatchScore = createActiveMatchScore(sourceCount, matchedCount, extraCount)
                const rpcScore = normalizeScore(candidate.score, activeMatchScore)

                if (sourceCount > 0 && candidate.match_type !== 'manual' && matchedCount === 0) {
                    return null
                }

                return {
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    type: product.type,
                    source_image_url: product.source_image_url,
                    market_segment: product.market_segment,
                    manufacturer: manufacturer?.name || candidate.manufacturer || null,
                    manufacturers: manufacturer,
                    formulation_type: formulationType,
                    formulation_types: formulationType,
                    active_ingredients: activeIngredients,
                    match_type: createMatchType(
                        candidate,
                        sourceCount,
                        matchedCount,
                        missingCount,
                        extraCount
                    ),
                    score: sourceCount > 0 ? activeMatchScore : rpcScore,
                    rpc_score: rpcScore,
                    reason: createMatchReason(
                        candidate,
                        sourceCount,
                        matchedCount,
                        missingCount,
                        extraCount
                    ),
                    match_label:
                        matchedCount === sourceCount && extraCount === 0
                            ? 'Найближчий аналог'
                            : matchedCount > 0
                                ? 'Схожий за діючою речовиною'
                                : 'Альтернатива',
                    matched_active_ingredients: matchedActiveIngredientNames,
                    missing_active_ingredients: match.missing.map(item => item.name),
                    extra_active_ingredients: match.extra.map(item => item.name),
                    match_details: {
                        matched_active_ingredients: match.matched,
                        missing_active_ingredients: match.missing,
                        extra_active_ingredients: match.extra,
                        matched_count: matchedCount,
                        source_count: sourceCount,
                        analog_count: activeIngredients.length,
                        active_match_score: activeMatchScore,
                        rpc_score: rpcScore
                    }
                }
            })
            .filter(item => Boolean(item))

        const validAnalogs = analogs.filter(Boolean)

        const groups = {
            closest: validAnalogs.filter((item: any) => item.score >= 90),
            same_active: validAnalogs.filter((item: any) => item.score >= 60 && item.score < 90),
            alternatives: validAnalogs.filter((item: any) => item.score < 60)
        }

        return {
            groups,
            analogs: validAnalogs
        }
    })

    app.get('/v1/products', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const {
            type,
            manufacturer,
            q,
            limit = '15',
            page = '1',
            exclude_types,
            include_types,
        } = request.query as {
            type?: string
            manufacturer?: string
            q?: string
            limit?: string
            page?: string
            exclude_types?: string
            include_types?: string
        }

        const pageNumber = Math.max(Number(page), 1)
        const limitNumber = Math.min(Math.max(Number(limit), 1), 100)
        const from = (pageNumber - 1) * limitNumber
        const to = from + limitNumber - 1

        const manufacturerRelation = manufacturer ? 'manufacturers!inner' : 'manufacturers'

        let query = supabase
            .from('products')
            .select(`
  id,
  name,
  slug,
  type,
  source_image_url,
  market_segment,
  ${manufacturerRelation} (
    name,
    slug
  ),
  formulation_types (
    code,
    name
  ),
  product_active_ingredients (
    active_ingredient_id,
    concentration,
    active_ingredients (
      id,
      name
    )
  )
`, {
                count: 'exact'
            })
            .eq('is_active', true)
            .order('name')
            .range(from, to)

        if (type) {
            query = query.eq('type', type)
        }

        if (include_types) {
            const included = include_types.split(',').map(s => s.trim()).filter(Boolean)
            if (included.length) query = query.in('type', included)
        } else if (exclude_types) {
            const excluded = exclude_types.split(',').map(s => s.trim()).filter(Boolean)
            if (excluded.length) query = query.not('type', 'in', `(${excluded.join(',')})`)
        }

        if (manufacturer) {
            query = query.eq('manufacturers.slug', manufacturer)
        }

        if (q) {
            query = query.ilike('name', `%${q}%`)
        }

        const { data, error, count } = await query

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        return {
            items: (data || []).map((product: any) => {
                const manufacturer = firstRelation(product.manufacturers)
                const formulationType = firstRelation(product.formulation_types)

                return {
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    type: product.type,
                    source_image_url: product.source_image_url,
                    market_segment: product.market_segment,
                    manufacturer,
                    manufacturers: manufacturer,
                    formulation_type: formulationType,
                    formulation_types: formulationType,
                    active_ingredients: toActiveIngredients(product.product_active_ingredients)
                }
            }),
            meta: {
                page: pageNumber,
                limit: limitNumber,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / limitNumber)
            }
        }
    })
}
