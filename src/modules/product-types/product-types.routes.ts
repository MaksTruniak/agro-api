import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

function firstRelation<T>(value: T | T[] | null | undefined) {
    if (Array.isArray(value)) {
        return value[0] || null
    }

    return value || null
}

function mapProductCard(product: any) {
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
        active_ingredients: (product.product_active_ingredients || [])
            .map((item: any) => {
                const activeIngredient = firstRelation(item.active_ingredients)

                return {
                    id: activeIngredient?.id || item.active_ingredient_id || null,
                    name: activeIngredient?.name || null,
                    concentration: item.concentration
                }
            })
            .filter((item: any) => item.name)
    }
}

export async function productTypesRoutes(app: FastifyInstance) {
    app.get('/v1/product-types', {
        preHandler: requireApiKey
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('product_types')
            .select(`
        id,
        slug,
        name,
        description,
        icon,
        color,
        sort_order
      `)
            .eq('is_active', true)
            .order('sort_order')

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        return {
            items: data || []
        }
    })

    app.get('/v1/product-types/:slug/products', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const {
            page = '1',
            limit = '15',
            q,
            manufacturer,
            market_segment
        } = request.query as {
            page?: string
            limit?: string
            q?: string
            manufacturer?: string
            market_segment?: string
        }

        const pageNumber = Math.max(Number(page), 1)
        const limitNumber = Math.min(Math.max(Number(limit), 1), 100)

        const from = (pageNumber - 1) * limitNumber
        const to = from + limitNumber - 1

        const { data: type, error: typeError } = await supabase
            .from('product_types')
            .select(`
        id,
        slug,
        name,
        description,
        icon,
        color
      `)
            .eq('slug', slug)
            .eq('is_active', true)
            .single()

        if (typeError || !type) {
            return reply.code(404).send({
                error: 'Product type not found'
            })
        }

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
            .eq('type', slug)
            .order('name')
            .range(from, to)

        if (q) {
            query = query.ilike('name', `%${q}%`)
        }

        if (manufacturer) {
            query = query.eq('manufacturers.slug', manufacturer)
        }

        if (market_segment) {
            query = query.eq('market_segment', market_segment)
        }

        const { data, error, count } = await query

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        return {
            type,
            items: (data || []).map(mapProductCard),
            meta: {
                page: pageNumber,
                limit: limitNumber,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / limitNumber)
            }
        }
    })
}
