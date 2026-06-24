import crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { supabase } from '../../lib/supabase'

export function hashApiKey(key: string) {
    return crypto.createHash('sha256').update(key).digest('hex')
}

export function generateApiKey() {
    const raw = crypto.randomBytes(32).toString('hex')
    return `agp_live_${raw}`
}

export async function requireApiKey(
    request: FastifyRequest,
    reply: FastifyReply
) {
    const auth = request.headers.authorization

    if (!auth?.startsWith('Bearer ')) {
        return reply.code(401).send({
            error: 'API key required'
        })
    }

    const apiKey = auth.replace('Bearer ', '').trim()
    const keyHash = hashApiKey(apiKey)
    const origin = request.headers.origin || request.headers.referer || ''

    const { data, error } = await supabase
        .from('api_keys')
        .select(`
      id,
      client_id,
      is_active,
      api_clients (
        id,
        name,
        allowed_domains,
        is_active
      )
    `)
        .eq('key_hash', keyHash)
        .single()

    const client = data?.api_clients as unknown as {
        is_active?: boolean
        allowed_domains?: string[]
    } | null

    console.log('AUTH DEBUG:', { keyHash, error: error?.message, data: data ? { is_active: data.is_active, client: client } : null })

    if (error || !data || !data.is_active || !client?.is_active) {
        return reply.code(401).send({
            error: 'Invalid API key'
        })
    }

    const allowedDomains = client.allowed_domains || []

    if (allowedDomains.length && origin) {
        const isAllowed = allowedDomains.some((domain: string) =>
            origin.includes(domain)
        )

        if (!isAllowed) {
            return reply.code(403).send({
                error: 'Origin not allowed'
            })
        }
    }

    await supabase
        .from('api_keys')
        .update({
            last_used_at: new Date().toISOString()
        })
        .eq('id', data.id)

    ;(request as any).apiClient = client
}
