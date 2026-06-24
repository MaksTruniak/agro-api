import type { FastifyReply, FastifyRequest } from 'fastify'
import { supabase } from '../../lib/supabase'

export type AdminUser = {
    id: string | null
    email: string | null
    role: string
    source: 'jwt' | 'api_key'
}

function getEnvList(name: string) {
    return (process.env[name] || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function resolveRole(user: any) {
    const appRole = user?.app_metadata?.role
    const userRole = user?.user_metadata?.role
    const roles = [
        appRole,
        userRole,
        ...(Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : []),
        ...(Array.isArray(user?.user_metadata?.roles) ? user.user_metadata.roles : [])
    ]
        .filter(Boolean)
        .map((item: unknown) => String(item).toLowerCase())

    if (roles.includes('admin')) {
        return 'admin'
    }

    return roles[0] || 'user'
}

export async function requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply
) {
    const auth = request.headers.authorization

    if (!auth?.startsWith('Bearer ')) {
        return reply.code(401).send({
            error: 'Admin authorization required'
        })
    }

    const token = auth.replace('Bearer ', '').trim()
    const adminApiKeys = [
        process.env.ADMIN_API_KEY?.trim(),
        ...getEnvList('ADMIN_API_KEYS')
    ].filter(Boolean) as string[]

    if (adminApiKeys.includes(token)) {
        ;(request as any).adminUser = {
            id: null,
            email: null,
            role: 'admin',
            source: 'api_key'
        } satisfies AdminUser

        return
    }

    const { data, error } = await supabase.auth.getUser(token)
    const user = data?.user
    const role = resolveRole(user)
    const adminEmails = getEnvList('ADMIN_EMAILS').map(item => item.toLowerCase())
    const email = user?.email?.toLowerCase() || null
    const isAdmin = role === 'admin' || (email ? adminEmails.includes(email) : false)

    if (error || !user) {
        return reply.code(401).send({
            error: 'Invalid admin token'
        })
    }

    if (!isAdmin) {
        return reply.code(403).send({
            error: 'Admin access required'
        })
    }

    ;(request as any).adminUser = {
        id: user.id,
        email: user.email || null,
        role: 'admin',
        source: 'jwt'
    } satisfies AdminUser
}
