import type { FastifyInstance } from 'fastify'
import { supabase } from '../../lib/supabase'
import { requireApiKey } from '../auth/api-key'

export async function fertilizersRoutes(app: FastifyInstance) {
  // GET /v1/fertilizers — список з фільтрацією
  app.get('/v1/fertilizers', { preHandler: requireApiKey }, async (request, reply) => {
    const { q, category, limit = '40', offset = '0' } = request.query as {
      q?: string; category?: string; limit?: string; offset?: string
    }

    let query = supabase
      .from('fertilizers')
      .select('id, name, slug, category_slug, formula, composition, mass_fraction, fertilizer_form, fertilizer_type, manufacturer, source_image_url', { count: 'exact' })
      .eq('is_active', true)
      .order('name')
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (q) query = query.ilike('name', `%${q.trim()}%`)
    if (category) query = query.eq('category_slug', category)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    return { items: data || [], total: count || 0, limit: Number(limit), offset: Number(offset) }
  })

  // GET /v1/fertilizers/categories — список категорій
  app.get('/v1/fertilizers/categories', { preHandler: requireApiKey }, async (request, reply) => {
    const { data, error } = await supabase
      .from('fertilizer_categories')
      .select('id, name, slug')
      .order('name')
    if (error) return reply.code(500).send({ error: error.message })
    return { items: data || [] }
  })

  // GET /v1/fertilizers/:slug — деталі
  app.get('/v1/fertilizers/:slug', { preHandler: requireApiKey }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const { data, error } = await supabase
      .from('fertilizers')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'Not found' })
    return { fertilizer: data }
  })
}
