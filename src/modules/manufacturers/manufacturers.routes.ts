import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

export async function manufacturersRoutes(app: FastifyInstance) {
    app.get('/v1/manufacturers', {
        preHandler: requireApiKey
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('manufacturers')
            .select(`
        id,
        name,
        slug,
        website_url,
        country,
        is_active
      `)
            .eq('is_active', true)
            .order('name')

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/manufacturers/:slug', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const { data, error } = await supabase
            .from('manufacturers')
            .select(`
        id,
        name,
        slug,
        website_url,
        country,
        is_active
      `)
            .eq('slug', slug)
            .eq('is_active', true)
            .single()

        if (error || !data) {
            return reply.code(404).send({
                error: 'Manufacturer not found'
            })
        }

        return {
            manufacturer: data
        }
    })

    app.get('/v1/manufacturers/:slug/products', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const { slug } = request.params as { slug: string }

        const {
            page = '1',
            limit = '15',
            q,
            type,
            market_segment
        } = request.query as {
            page?: string
            limit?: string
            q?: string
            type?: string
            market_segment?: string
        }

        const pageNumber = Math.max(Number(page), 1)
        const limitNumber = Math.min(Math.max(Number(limit), 1), 100)
        const from = (pageNumber - 1) * limitNumber
        const to = from + limitNumber - 1

        const { data: manufacturer, error: manufacturerError } = await supabase
            .from('manufacturers')
            .select('id, name, slug, website_url, country')
            .eq('slug', slug)
            .eq('is_active', true)
            .single()

        if (manufacturerError || !manufacturer) {
            return reply.code(404).send({
                error: 'Manufacturer not found'
            })
        }

        let query = supabase
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
      `, {
                count: 'exact'
            })
            .eq('is_active', true)
            .eq('manufacturer_id', manufacturer.id)
            .order('name')
            .range(from, to)

        if (q) {
            query = query.ilike('name', `%${q}%`)
        }

        if (type) {
            query = query.eq('type', type)
        }

        if (market_segment) {
            query = query.eq('market_segment', market_segment)
        }

        const { data, error, count } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return {
            manufacturer,
            items: (data || []).map((product: any) => ({
                ...product,
                manufacturer: Array.isArray(product.manufacturers)
                    ? product.manufacturers[0]
                    : product.manufacturers,
                formulation_type: Array.isArray(product.formulation_types)
                    ? product.formulation_types[0]
                    : product.formulation_types,
                active_ingredients: product.product_active_ingredients?.map((item: any) => ({
                    id: item.active_ingredients?.id,
                    name: item.active_ingredients?.name,
                    concentration: item.concentration
                })) || []
            })),
            meta: {
                page: pageNumber,
                limit: limitNumber,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / limitNumber)
            }
        }
    })
}
