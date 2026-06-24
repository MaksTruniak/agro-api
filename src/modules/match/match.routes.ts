import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'
import { findActiveIngredientIds } from '../active-ingredients/search'

export async function matchRoutes(app: FastifyInstance) {
    app.post('/v1/product-match', {
        preHandler: requireApiKey
    }, async (request, reply) => {
        const body = request.body as {
            name?: string
            manufacturer?: string
            active_ingredients?: string[]
            type?: string
        }

        if (!body?.name && !body?.active_ingredients?.length) {
            return reply.code(400).send({
                error: 'name or active_ingredients is required'
            })
        }

        let matchedProduct: any = null

        if (body.name) {
            let query = supabase
                .from('products')
                .select(`
          id,
          name,
          slug,
          type,
          manufacturers (
            name,
            slug
          )
        `)
                .ilike('name', `%${body.name}%`)
                .limit(1)

            if (body.type) {
                query = query.eq('type', body.type)
            }

            const { data } = await query.single()
            matchedProduct = data || null
        }

        if (!matchedProduct && body.active_ingredients?.length) {
            const ingredientIds = await findActiveIngredientIds(body.active_ingredients)

            if (ingredientIds.length) {
                let query = supabase
                    .from('products')
                    .select(`
            id,
            name,
            slug,
            type,
            manufacturers (
              name,
              slug
            ),
            product_active_ingredients!inner (
              active_ingredient_id
            )
          `)
                    .in('product_active_ingredients.active_ingredient_id', ingredientIds)
                    .limit(1)

                if (body.type) {
                    query = query.eq('type', body.type)
                }

                const { data } = await query.single()
                matchedProduct = data || null
            }
        }

        if (!matchedProduct) {
            return {
                matched_product: null,
                analogs: []
            }
        }

        const { data: analogs, error } = await supabase.rpc('get_product_analogs', {
            product_slug: matchedProduct.slug
        })

        if (error) {
            return reply.code(500).send({
                error: error.message
            })
        }

        return {
            matched_product: matchedProduct,
            analogs: analogs || []
        }
    })
}