import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

export async function catalogRoutes(app: FastifyInstance) {
    app.get('/v1/catalog/facets', {
        preHandler: requireApiKey
    }, async (_request, reply) => {
        const [
            productTypesResult,
            manufacturersResult,
            formulationTypesResult,
            productsResult
        ] = await Promise.all([
            supabase
                .from('product_types')
                .select('id,name,slug')
                .eq('is_active', true)
                .order('name'),

            supabase
                .from('manufacturers')
                .select('id,name,slug')
                .eq('is_active', true)
                .order('name'),

            supabase
                .from('formulation_types')
                .select('id,code,name')
                .order('name'),

            supabase
                .from('products')
                .select(`
          id,
          type,
          market_segment,
          manufacturer_id,
          formulation_type_id
        `)
                .eq('is_active', true)
        ])

        if (
            productTypesResult.error ||
            manufacturersResult.error ||
            formulationTypesResult.error ||
            productsResult.error
        ) {
            return reply.code(500).send({
                error:
                    productTypesResult.error?.message ||
                    manufacturersResult.error?.message ||
                    formulationTypesResult.error?.message ||
                    productsResult.error?.message
            })
        }

        const products = productsResult.data || []

        const types = (productTypesResult.data || []).map(type => ({
            ...type,
            count: products.filter(product => product.type === type.slug).length
        }))

        const manufacturers = (manufacturersResult.data || []).map(manufacturer => ({
            ...manufacturer,
            count: products.filter(
                product => product.manufacturer_id === manufacturer.id
            ).length
        }))

        const formulationTypes = (formulationTypesResult.data || []).map(formulation => ({
            ...formulation,
            count: products.filter(
                product => product.formulation_type_id === formulation.id
            ).length
        }))

        const marketSegmentsMap = new Map<string, number>()

        for (const product of products) {
            const key = product.market_segment || 'unknown'

            marketSegmentsMap.set(
                key,
                (marketSegmentsMap.get(key) || 0) + 1
            )
        }

        const marketSegments = [...marketSegmentsMap.entries()].map(
            ([slug, count]) => ({
                slug,
                name: slug,
                count
            })
        )

        return {
            types,
            manufacturers,
            formulation_types: formulationTypes,
            market_segments: marketSegments
        }
    })
}