import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'
import { createActiveIngredientSlug, isUuid } from './slug'

type ActiveIngredientRecord = {
    id: string
    name: string
    description: string | null
}

function withActiveIngredientSlug(ingredient: ActiveIngredientRecord) {
    return {
        ...ingredient,
        slug: createActiveIngredientSlug(ingredient.name)
    }
}

async function findActiveIngredients(slugOrId: string) {
    if (isUuid(slugOrId)) {
        const { data, error } = await supabase
            .from('active_ingredients')
            .select('id, name, description')
            .eq('id', slugOrId)
            .single()

        return {
            ingredients: data ? [withActiveIngredientSlug(data as ActiveIngredientRecord)] : [],
            error
        }
    }

    const { data, error } = await supabase
        .from('active_ingredients')
        .select('id, name, description')

    if (error) {
        return {
            ingredients: [],
            error
        }
    }

    return {
        ingredients: (data || [])
            .map(item => withActiveIngredientSlug(item as ActiveIngredientRecord))
            .filter(item => item.slug === slugOrId),
        error: null
    }
}

export async function activeIngredientsRoutes(app: FastifyInstance) {
    app.get('/v1/active-ingredients/search', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { q } = request.query as { q?: string }

        if (!q) {
            return reply.code(400).send({
                error: 'q is required'
            })
        }

        const normalized = q.toLowerCase().trim()

        const { data, error } = await supabase
            .from('active_ingredients')
            .select('id, name, description')
            .ilike('name', `%${normalized}%`)
            .order('name')
            .limit(20)

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        return {
            items: (data || []).map((item: any) => withActiveIngredientSlug(item))
        }
    })

    app.get('/v1/active-ingredients/:slug', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const { ingredients, error: ingredientError } = await findActiveIngredients(slug)

        if (ingredientError || !ingredients.length) {
            return reply.code(404).send({
                error: 'Active ingredient not found'
            })
        }

        const ingredientIds = ingredients.map(item => item.id)

        const { data: productIngredients, error: productsError } = await supabase
            .from('product_active_ingredients')
            .select(`
        active_ingredient_id,
        concentration,
        products!inner (
          id,
          name,
          slug,
          type,
          description,
          source_image_url,
          market_segment,
          is_active,
          manufacturers (
            name,
            slug
          ),
          formulation_types (
            code,
            name
          )
        )
      `)
            .in('active_ingredient_id', ingredientIds)
            .eq('products.is_active', true)

        if (productsError) {
            return reply.code(500).send({
                error: productsError.message
            })
        }

        const productCountByIngredient = new Map<string, number>()

        for (const item of productIngredients || []) {
            const count = productCountByIngredient.get(item.active_ingredient_id) || 0
            productCountByIngredient.set(item.active_ingredient_id, count + 1)
        }

        const ingredient = [...ingredients].sort((first, second) => {
            const productCountDiff = (productCountByIngredient.get(second.id) || 0)
                - (productCountByIngredient.get(first.id) || 0)

            if (productCountDiff !== 0) return productCountDiff

            return first.name.localeCompare(second.name, 'uk')
        })[0]

        const productsBySlug = new Map<string, any>()

        for (const item of productIngredients || []) {
            const product = Array.isArray(item.products) ? item.products[0] : item.products

            if (!product) continue

            const manufacturer = Array.isArray(product.manufacturers)
                ? product.manufacturers[0]
                : product.manufacturers

            const formulationType = Array.isArray(product.formulation_types)
                ? product.formulation_types[0]
                : product.formulation_types

            if (!productsBySlug.has(product.slug)) {
                productsBySlug.set(product.slug, {
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    type: product.type,
                    description: product.description,
                    source_image_url: product.source_image_url,
                    market_segment: product.market_segment,
                    manufacturer,
                    manufacturers: manufacturer,
                    formulation_type: formulationType,
                    formulation_types: formulationType,
                    active_ingredients: [
                        {
                            id: ingredient.id,
                            name: ingredient.name,
                            slug: ingredient.slug,
                            concentration: item.concentration
                        }
                    ]
                })
            }
        }

        const products = [...productsBySlug.values()]
            .sort((first: any, second: any) => first.name.localeCompare(second.name, 'uk'))

        return {
            ingredient,
            products,
            meta: {
                products_count: products.length
            }
        }
    })
}