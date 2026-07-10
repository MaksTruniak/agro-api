import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

export async function weedsRoutes(app: FastifyInstance) {
  app.get('/v1/weeds', { preHandler: requireApiKey }, async (request, reply) => {
    const { q, category, bio_class, limit = '40', offset = '0' } = request.query as {
      q?: string; category?: string; bio_class?: string; limit?: string; offset?: string
    }

    let query = supabase
      .from('weeds')
      .select(`
        id, name, slug, latin_name, family, crops_affected, distribution_zones, source_image_url,
        weed_categories ( id, name, slug ),
        weed_classes ( id, name, slug )
      `, { count: 'exact' })
      .eq('is_active', true)
      .order('name')
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (q) query = query.ilike('name', `%${q.trim()}%`)
    if (category) query = query.eq('weed_categories.slug', category)
    if (bio_class) query = query.eq('weed_classes.slug', bio_class)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    return { items: data || [], total: count || 0, limit: Number(limit), offset: Number(offset) }
  })

  app.get('/v1/weeds/categories', { preHandler: requireApiKey }, async (_request, reply) => {
    const { data, error } = await supabase.from('weed_categories').select('id, name, slug').order('name')
    if (error) return reply.code(500).send({ error: error.message })
    return { items: data || [] }
  })

  app.get('/v1/weeds/classes', { preHandler: requireApiKey }, async (_request, reply) => {
    const { data, error } = await supabase.from('weed_classes').select('id, name, slug').order('name')
    if (error) return reply.code(500).send({ error: error.message })
    return { items: data || [] }
  })

  app.get('/v1/weeds/:slug', { preHandler: requireApiKey }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const { data, error } = await supabase
      .from('weeds')
      .select(`
        *,
        weed_categories ( id, name, slug ),
        weed_classes ( id, name, slug ),
        weed_products (
          products (
            id, name, slug, type, source_image_url,
            manufacturers ( name, slug ),
            formulation_types ( code, name )
          )
        )
      `)
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'Not found' })

    const herbicides = (data.weed_products || [])
      .map((wp: any) => wp.products)
      .filter(Boolean)

    return {
      weed: {
        ...data,
        category: data.weed_categories,
        bio_class: data.weed_classes,
        herbicides,
        weed_products: undefined,
        weed_categories: undefined,
        weed_classes: undefined,
      }
    }
  })
}
