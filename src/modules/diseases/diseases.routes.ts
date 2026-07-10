import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

export async function diseasesRoutes(app: FastifyInstance) {
  app.get('/v1/diseases', { preHandler: requireApiKey }, async (request, reply) => {
    const { q, category, culture, limit = '40', offset = '0' } = request.query as {
      q?: string; category?: string; culture?: string; limit?: string; offset?: string
    }

    let query = supabase
      .from('diseases')
      .select(`
        id, name, slug, latin_name, culture, pathogen, source_image_url,
        disease_categories ( id, name, slug )
      `, { count: 'exact' })
      .eq('is_active', true)
      .order('name')
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (q) query = query.ilike('name', `%${q.trim()}%`)
    if (category) query = query.eq('disease_categories.slug', category)
    if (culture) query = query.ilike('culture', `%${culture}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    return { items: data || [], total: count || 0, limit: Number(limit), offset: Number(offset) }
  })

  app.get('/v1/diseases/categories', { preHandler: requireApiKey }, async (_request, reply) => {
    const { data, error } = await supabase.from('disease_categories').select('id, name, slug').order('name')
    if (error) return reply.code(500).send({ error: error.message })
    return { items: data || [] }
  })

  app.get('/v1/diseases/cultures', { preHandler: requireApiKey }, async (_request, reply) => {
    const { data, error } = await supabase
      .from('diseases')
      .select('culture')
      .not('culture', 'is', null)
      .eq('is_active', true)
    if (error) return reply.code(500).send({ error: error.message })

    const cultures = [...new Set(
      (data || [])
        .flatMap((d: any) => (d.culture || '').split(',').map((c: string) => c.trim()))
        .filter(Boolean)
    )].sort()

    return { items: cultures }
  })

  app.get('/v1/diseases/:slug', { preHandler: requireApiKey }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const { data, error } = await supabase
      .from('diseases')
      .select(`
        *,
        disease_categories ( id, name, slug ),
        disease_products (
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

    const products = (data.disease_products || [])
      .map((dp: any) => dp.products)
      .filter(Boolean)

    return {
      disease: {
        ...data,
        category: data.disease_categories,
        products,
        disease_products: undefined,
        disease_categories: undefined,
      }
    }
  })
}
