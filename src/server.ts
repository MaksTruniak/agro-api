import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import rateLimit from '@fastify/rate-limit'
import { supabase } from './lib/supabase'
import { productsRoutes } from './modules/products/products.routes'
import { activeIngredientsRoutes } from './modules/active-ingredients/active-ingredients.routes'
import { matchRoutes } from './modules/match/match.routes'
import { productTypesRoutes } from './modules/product-types/product-types.routes'
import { manufacturersRoutes } from './modules/manufacturers/manufacturers.routes'
import { catalogRoutes } from './modules/catalog/catalog.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { aiRoutes } from './modules/ai/ai.routes';
async function main() {
    const app = Fastify({
        logger: true
    })

    await app.register(cors, {
        origin: true
    })

    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute'
    })

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Agro API',
                version: '1.0.0'
            }
        }
    })

    await app.register(swaggerUi, {
        routePrefix: '/docs'
    })

    app.addHook('onResponse', async (request, reply) => {
        const client = (request as any).apiClient

        if (!client) return

        await supabase.from('api_usage_logs').insert({
            client_id: client.id,
            endpoint: request.url,
            ip: request.ip,
            origin: request.headers.origin || request.headers.referer || null,
            user_agent: request.headers['user-agent'] || null,
            response_status: reply.statusCode
        })
    })

    app.get('/health', async () => {
        return { ok: true }
    })

    await app.register(productsRoutes)
    await app.register(activeIngredientsRoutes)
    await app.register(matchRoutes)

    await app.register(productTypesRoutes)

    await app.register(manufacturersRoutes)

    await app.register(catalogRoutes)

    await app.register(adminRoutes)

    await app.register(aiRoutes)

    const port = Number(process.env.PORT || 4000)

    await app.listen({
        port,
        host: '0.0.0.0'
    })
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
