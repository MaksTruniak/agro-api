import type { FastifyInstance } from 'fastify'
import slugify from 'slugify'
import { supabase } from '../../lib/supabase'
import { createActiveIngredientSlug } from '../active-ingredients/slug'
import { requireAdmin } from '../auth/admin'

type SingleOrArray<T> = T | T[] | null | undefined

function firstRelation<T>(value: SingleOrArray<T>) {
    if (Array.isArray(value)) {
        return value[0] || null
    }

    return value || null
}

function parsePageLimit(query: { page?: string; limit?: string }, defaultLimit: number) {
    const pageNumber = Math.max(Number(query.page || 1), 1)
    const limitNumber = Math.min(Math.max(Number(query.limit || defaultLimit), 1), 100)
    const from = (pageNumber - 1) * limitNumber
    const to = from + limitNumber - 1

    return {
        pageNumber,
        limitNumber,
        from,
        to
    }
}

function toSlug(value: string) {
    return slugify(value, {
        lower: true,
        strict: true,
        locale: 'uk'
    })
}

function normalizeNullable(value: unknown) {
    if (value === undefined) return undefined
    if (value === null) return null

    const text = String(value).trim()
    return text ? text : null
}

function mapProductListItem(product: any) {
    const manufacturer = firstRelation(product.manufacturers)
    const formulationType = firstRelation(product.formulation_types)
    const productLine = firstRelation(product.product_lines)

    return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        type: product.type,
        description: product.description,
        source_url: product.source_url,
        source_image_url: product.source_image_url,
        market_segment: product.market_segment,
        manufacturer_id: product.manufacturer_id,
        product_line_id: product.product_line_id,
        formulation_type_id: product.formulation_type_id,
        is_active: product.is_active,
        manufacturer,
        manufacturer_name: manufacturer?.name || product.manufacturer_name || null,
        manufacturer_slug: manufacturer?.slug || product.manufacturer_slug || null,
        product_line: productLine,
        product_line_name: productLine?.name || product.product_line_name || null,
        formulation_type: formulationType,
        active_ingredients: product.active_ingredients || null
    }
}

function mapIngredientLink(item: any) {
    const ingredient = firstRelation(item.active_ingredients)
    const activeIngredient = ingredient
        ? {
            id: ingredient.id || item.active_ingredient_id || null,
            name: ingredient.name,
            slug: ingredient.name ? createActiveIngredientSlug(ingredient.name) : null,
            description: ingredient.description || null
        }
        : null

    return {
        id: item.id,
        link_id: String(item.id),
        active_ingredient_id: item.active_ingredient_id,
        concentration: item.concentration,
        active_ingredient: activeIngredient,
        active_ingredients: activeIngredient
    }
}

function mapPackageLink(item: any) {
    const packageUnit = firstRelation(item.package_units)

    return {
        id: item.id,
        package_id: String(item.id),
        amount: item.amount,
        unit: item.unit,
        label: item.label,
        sort_order: item.sort_order,
        package_unit_id: item.package_unit_id,
        package_unit: packageUnit,
        package_units: packageUnit
    }
}

async function getProductOrNull(productId: string) {
    const { data, error } = await supabase
        .from('products')
        .select(`
      id,
      name,
      slug,
      type,
      description,
      source_url,
      source_image_url,
      market_segment,
      manufacturer_id,
      product_line_id,
      formulation_type_id,
      action_method,
      working_solution_rate,
      storage_temperature,
      is_active,
      manufacturers (
        id,
        name,
        slug
      ),
      formulation_types (
        id,
        code,
        name
      ),
      product_lines (
        id,
        manufacturer_id,
        name,
        slug,
        description,
        is_active
      ),
      product_packages (
        id,
        amount,
        unit,
        label,
        sort_order,
        package_unit_id,
        package_units (
          id,
          code,
          symbol,
          name
        )
      ),
      product_active_ingredients (
        id,
        active_ingredient_id,
        concentration,
        active_ingredients (
          id,
          name,
          description
        )
      ),
      product_content_sections (
        section_key,
        title,
        content,
        sort_order
      )
    `)
        .eq('id', productId)
        .single()

    if (error || !data) {
        return null
    }

    return {
        ...mapProductListItem(data),
        action_method: data.action_method,
        working_solution_rate: data.working_solution_rate,
        storage_temperature: data.storage_temperature,
        ingredients: (data.product_active_ingredients || []).map(mapIngredientLink),
        packages: (data.product_packages || [])
            .sort((first: any, second: any) => (first.sort_order || 0) - (second.sort_order || 0))
            .map(mapPackageLink),
        content_sections: (data.product_content_sections || [])
            .sort((first: any, second: any) => (first.sort_order || 0) - (second.sort_order || 0))
    }
}

async function resolveActiveIngredientId(payload: {
    active_ingredient_id?: string
    name?: string
    description?: string | null
}) {
    if (payload.active_ingredient_id) {
        return payload.active_ingredient_id
    }

    if (!payload.name?.trim()) {
        return null
    }

    const { data, error } = await supabase
        .from('active_ingredients')
        .upsert({
            name: payload.name.trim(),
            description: normalizeNullable(payload.description)
        }, {
            onConflict: 'name'
        })
        .select('id')
        .single()

    if (error) {
        throw error
    }

    return data.id
}

async function resolvePackageUnitId(payload: {
    package_unit_id?: string
    code?: string
}) {
    if (payload.package_unit_id) {
        return payload.package_unit_id
    }

    if (!payload.code?.trim()) {
        return null
    }

    const { data, error } = await supabase
        .from('package_units')
        .select('id')
        .eq('code', payload.code.trim())
        .single()

    if (error || !data) {
        return null
    }

    return data.id
}

export async function adminRoutes(app: FastifyInstance) {
    app.get('/v1/admin/me', {
        preHandler: requireAdmin
    }, async (request) => {
        return {
            user: (request as any).adminUser
        }
    })

    app.get('/v1/admin/products', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { manufacturer, q, is_active } = request.query as {
            manufacturer?: string
            q?: string
            is_active?: string
            page?: string
            limit?: string
        }
        const { pageNumber, limitNumber, from, to } = parsePageLimit(request.query as any, 15)

        let query = supabase
            .from('admin_products_view')
            .select('*', { count: 'exact' })
            .order('name')
            .range(from, to)

        if (manufacturer) {
            query = query.eq('manufacturer_slug', manufacturer)
        }

        if (q) {
            query = query.ilike('name', `%${q}%`)
        }

        if (is_active === 'true') {
            query = query.eq('is_active', true)
        }

        if (is_active === 'false') {
            query = query.eq('is_active', false)
        }

        const { data, error, count } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return {
            items: data || [],
            meta: {
                page: pageNumber,
                limit: limitNumber,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / limitNumber)
            }
        }
    })

    app.get('/v1/admin/products/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const product = await getProductOrNull(id)

        if (!product) {
            return reply.code(404).send({ error: 'Product not found' })
        }

        return { product }
    })

    app.post('/v1/admin/products', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as Record<string, unknown>

        if (!String(body.name || '').trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('products')
            .insert({
                name: String(body.name).trim(),
                slug: normalizeNullable(body.slug) || toSlug(String(body.name)),
                type: normalizeNullable(body.type),
                description: normalizeNullable(body.description),
                source_url: normalizeNullable(body.source_url),
                source_image_url: normalizeNullable(body.source_image_url),
                market_segment: normalizeNullable(body.market_segment),
                manufacturer_id: normalizeNullable(body.manufacturer_id),
                product_line_id: normalizeNullable(body.product_line_id),
                formulation_type_id: normalizeNullable(body.formulation_type_id),
                action_method: normalizeNullable(body.action_method),
                working_solution_rate: normalizeNullable(body.working_solution_rate),
                storage_temperature: normalizeNullable(body.storage_temperature),
                is_active: body.is_active === undefined ? true : Boolean(body.is_active)
            })
            .select('id')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create product' })
        }

        const product = await getProductOrNull(data.id)
        return reply.code(201).send({ product })
    })

    app.put('/v1/admin/products/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as Record<string, unknown>
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.type !== undefined ? { type: normalizeNullable(body.type) } : {}),
            ...(body.description !== undefined ? { description: normalizeNullable(body.description) } : {}),
            ...(body.source_url !== undefined ? { source_url: normalizeNullable(body.source_url) } : {}),
            ...(body.source_image_url !== undefined ? { source_image_url: normalizeNullable(body.source_image_url) } : {}),
            ...(body.market_segment !== undefined ? { market_segment: normalizeNullable(body.market_segment) } : {}),
            ...(body.manufacturer_id !== undefined ? { manufacturer_id: normalizeNullable(body.manufacturer_id) } : {}),
            ...(body.product_line_id !== undefined ? { product_line_id: normalizeNullable(body.product_line_id) } : {}),
            ...(body.formulation_type_id !== undefined ? { formulation_type_id: normalizeNullable(body.formulation_type_id) } : {}),
            ...(body.action_method !== undefined ? { action_method: normalizeNullable(body.action_method) } : {}),
            ...(body.working_solution_rate !== undefined ? { working_solution_rate: normalizeNullable(body.working_solution_rate) } : {}),
            ...(body.storage_temperature !== undefined ? { storage_temperature: normalizeNullable(body.storage_temperature) } : {}),
            ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { error } = await supabase
            .from('products')
            .update(updates)
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        const product = await getProductOrNull(id)

        if (!product) {
            return reply.code(404).send({ error: 'Product not found' })
        }

        return { product }
    })

    app.delete('/v1/admin/products/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('products')
            .update({ is_active: false })
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true, soft: true }
    })

    app.get('/v1/admin/products/:id/ingredients', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('product_active_ingredients')
            .select(`
        id,
        active_ingredient_id,
        concentration,
        active_ingredients (
          id,
          name,
          description
        )
      `)
            .eq('product_id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { items: (data || []).map(mapIngredientLink) }
    })

    app.post('/v1/admin/products/:id/ingredients', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as {
            active_ingredient_id?: string
            name?: string
            description?: string | null
            concentration?: string | null
        }
        const activeIngredientId = await resolveActiveIngredientId(body)

        if (!activeIngredientId) {
            return reply.code(400).send({ error: 'active_ingredient_id or name is required' })
        }

        const { error } = await supabase
            .from('product_active_ingredients')
            .insert({
                product_id: id,
                active_ingredient_id: activeIngredientId,
                concentration: normalizeNullable(body.concentration)
            })

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        const { data } = await supabase
            .from('product_active_ingredients')
            .select(`
        id,
        active_ingredient_id,
        concentration,
        active_ingredients (
          id,
          name,
          description
        )
      `)
            .eq('product_id', id)
            .eq('active_ingredient_id', activeIngredientId)
            .order('id', { ascending: false })
            .limit(1)
            .single()

        return reply.code(201).send({ item: data ? mapIngredientLink(data) : null })
    })

    app.put('/v1/admin/products/:id/ingredients/:linkId', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id, linkId } = request.params as { id: string; linkId: string }
        const body = request.body as {
            active_ingredient_id?: string
            name?: string
            description?: string | null
            concentration?: string | null
        }

        const { data: currentLink, error: currentLinkError } = await supabase
            .from('product_active_ingredients')
            .select('id, active_ingredient_id, concentration')
            .eq('id', linkId)
            .eq('product_id', id)
            .single()

        if (currentLinkError || !currentLink) {
            return reply.code(404).send({ error: 'Ingredient link not found' })
        }

        const nextActiveIngredientId = await resolveActiveIngredientId(body)
        const updates = {
            ...(nextActiveIngredientId ? { active_ingredient_id: nextActiveIngredientId } : {}),
            ...(body.concentration !== undefined ? { concentration: normalizeNullable(body.concentration) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { error } = await supabase
            .from('product_active_ingredients')
            .update(updates)
            .eq('id', linkId)
            .eq('product_id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        const { data } = await supabase
            .from('product_active_ingredients')
            .select(`
        id,
        active_ingredient_id,
        concentration,
        active_ingredients (
          id,
          name,
          description
        )
      `)
            .eq('id', linkId)
            .single()

        return { item: data ? mapIngredientLink(data) : null }
    })

    app.delete('/v1/admin/products/:id/ingredients/:linkId', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id, linkId } = request.params as { id: string; linkId: string }
        const { error } = await supabase
            .from('product_active_ingredients')
            .delete()
            .eq('id', linkId)
            .eq('product_id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true }
    })

    app.get('/v1/admin/products/:id/packages', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('product_packages')
            .select(`
        id,
        amount,
        unit,
        label,
        sort_order,
        package_unit_id,
        package_units (
          id,
          code,
          symbol,
          name
        )
      `)
            .eq('product_id', id)
            .order('sort_order')

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { items: (data || []).map(mapPackageLink) }
    })

    app.post('/v1/admin/products/:id/packages', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as {
            amount?: string | number
            unit?: string | null
            label?: string | null
            sort_order?: number | null
            package_unit_id?: string
            code?: string
        }
        const packageUnitId = await resolvePackageUnitId(body)

        if (!packageUnitId || body.amount === undefined || body.amount === null || body.amount === '') {
            return reply.code(400).send({ error: 'amount and package_unit_id are required' })
        }

        const { error } = await supabase
            .from('product_packages')
            .insert({
                product_id: id,
                amount: body.amount,
                unit: normalizeNullable(body.unit),
                label: normalizeNullable(body.label),
                sort_order: body.sort_order ?? 0,
                package_unit_id: packageUnitId
            })

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        const { data } = await supabase
            .from('product_packages')
            .select(`
        id,
        amount,
        unit,
        label,
        sort_order,
        package_unit_id,
        package_units (
          id,
          code,
          symbol,
          name
        )
      `)
            .eq('product_id', id)
            .eq('amount', body.amount as any)
            .eq('package_unit_id', packageUnitId)
            .order('id', { ascending: false })
            .limit(1)
            .single()

        return reply.code(201).send({ item: data ? mapPackageLink(data) : null })
    })

    app.put('/v1/admin/products/:id/packages/:packageId', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id, packageId } = request.params as { id: string; packageId: string }
        const body = request.body as {
            amount?: string | number
            unit?: string | null
            label?: string | null
            sort_order?: number | null
            package_unit_id?: string
            code?: string
        }

        const { data: currentRow, error: currentRowError } = await supabase
            .from('product_packages')
            .select('id, amount, unit, label, sort_order, package_unit_id')
            .eq('id', packageId)
            .eq('product_id', id)
            .single()

        if (currentRowError || !currentRow) {
            return reply.code(404).send({ error: 'Package not found' })
        }

        const nextPackageUnitId = body.package_unit_id || body.code
            ? await resolvePackageUnitId(body)
            : String(currentRow.package_unit_id)

        if (!nextPackageUnitId) {
            return reply.code(400).send({ error: 'package_unit_id is invalid' })
        }

        const updates = {
            amount: body.amount ?? currentRow.amount,
            unit: body.unit === undefined ? currentRow.unit : normalizeNullable(body.unit),
            label: body.label === undefined ? currentRow.label : normalizeNullable(body.label),
            sort_order: body.sort_order === undefined ? currentRow.sort_order : body.sort_order,
            package_unit_id: nextPackageUnitId
        }

        const { error } = await supabase
            .from('product_packages')
            .update(updates)
            .eq('id', packageId)
            .eq('product_id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        const { data } = await supabase
            .from('product_packages')
            .select(`
        id,
        amount,
        unit,
        label,
        sort_order,
        package_unit_id,
        package_units (
          id,
          code,
          symbol,
          name
        )
      `)
            .eq('id', packageId)
            .single()

        return { item: data ? mapPackageLink(data) : null }
    })

    app.delete('/v1/admin/products/:id/packages/:packageId', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id, packageId } = request.params as { id: string; packageId: string }
        const { error } = await supabase
            .from('product_packages')
            .delete()
            .eq('id', packageId)
            .eq('product_id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true }
    })

    app.get('/v1/admin/active-ingredients', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { q } = request.query as { q?: string; page?: string; limit?: string }
        const { pageNumber, limitNumber, from, to } = parsePageLimit(request.query as any, 50)

        let query = supabase
            .from('active_ingredients')
            .select(`
        id,
        name,
        description,
        product_active_ingredients (
          id,
          concentration
        )
      `, { count: 'exact' })
            .order('name')
            .range(from, to)

        if (q) {
            query = query.ilike('name', `%${q}%`)
        }

        const { data, error, count } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return {
            items: (data || []).map(item => ({
                ...item,
                slug: createActiveIngredientSlug(item.name)
            })),
            meta: {
                page: pageNumber,
                limit: limitNumber,
                total: count || 0,
                total_pages: Math.ceil((count || 0) / limitNumber)
            }
        }
    })

    app.get('/v1/admin/active-ingredients/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('active_ingredients')
            .select(`
        id,
        name,
        description,
        product_active_ingredients (
          id,
          concentration
        )
      `)
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Active ingredient not found' })
        }

        return {
            item: {
                ...data,
                slug: createActiveIngredientSlug(data.name)
            }
        }
    })

    app.post('/v1/admin/active-ingredients', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as { name?: string; description?: string | null }

        if (!body.name?.trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('active_ingredients')
            .insert({
                name: body.name.trim(),
                description: normalizeNullable(body.description)
            })
            .select('id, name, description')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create active ingredient' })
        }

        return reply.code(201).send({
            item: {
                ...data,
                slug: createActiveIngredientSlug(data.name)
            }
        })
    })

    app.post('/v1/admin/active-ingredients/merge', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as { source_id?: string; target_id?: string }

        if (!body.source_id || !body.target_id || body.source_id === body.target_id) {
            return reply.code(400).send({ error: 'source_id and target_id are required and must be different' })
        }

        const { error: updateError } = await supabase
            .from('product_active_ingredients')
            .update({ active_ingredient_id: body.target_id })
            .eq('active_ingredient_id', body.source_id)

        if (updateError) {
            return reply.code(400).send({ error: updateError.message })
        }

        const { error: deleteError } = await supabase
            .from('active_ingredients')
            .delete()
            .eq('id', body.source_id)

        if (deleteError) {
            return reply.code(400).send({ error: deleteError.message })
        }

        return { ok: true }
    })

    app.put('/v1/admin/active-ingredients/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as { name?: string; description?: string | null }
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.description !== undefined ? { description: normalizeNullable(body.description) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('active_ingredients')
            .update(updates)
            .eq('id', id)
            .select('id, name, description')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update active ingredient' })
        }

        return {
            item: {
                ...data,
                slug: createActiveIngredientSlug(data.name)
            }
        }
    })

    app.delete('/v1/admin/active-ingredients/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('active_ingredients')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true }
    })

    app.get('/v1/admin/manufacturers', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { active } = request.query as { active?: string }
        let query = supabase
            .from('manufacturers')
            .select('id, name, slug, country, website_url, description, is_active')
            .order('name')

        if (active === 'true') {
            query = query.eq('is_active', true)
        }

        if (active === 'false') {
            query = query.eq('is_active', false)
        }

        const { data, error } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/manufacturers/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('manufacturers')
            .select('id, name, slug, country, website_url, description, is_active')
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Manufacturer not found' })
        }

        return { item: data }
    })

    app.post('/v1/admin/manufacturers', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as {
            name?: string
            slug?: string
            country?: string | null
            website_url?: string | null
            description?: string | null
            is_active?: boolean
        }

        if (!body.name?.trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('manufacturers')
            .insert({
                name: body.name.trim(),
                slug: normalizeNullable(body.slug) || toSlug(body.name),
                country: normalizeNullable(body.country),
                website_url: normalizeNullable(body.website_url),
                description: normalizeNullable(body.description),
                is_active: body.is_active === undefined ? true : Boolean(body.is_active)
            })
            .select('id, name, slug, country, website_url, description, is_active')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create manufacturer' })
        }

        return reply.code(201).send({ item: data })
    })

    app.put('/v1/admin/manufacturers/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as {
            name?: string
            slug?: string
            country?: string | null
            website_url?: string | null
            description?: string | null
            is_active?: boolean
        }
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.country !== undefined ? { country: normalizeNullable(body.country) } : {}),
            ...(body.website_url !== undefined ? { website_url: normalizeNullable(body.website_url) } : {}),
            ...(body.description !== undefined ? { description: normalizeNullable(body.description) } : {}),
            ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('manufacturers')
            .update(updates)
            .eq('id', id)
            .select('id, name, slug, country, website_url, description, is_active')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update manufacturer' })
        }

        return { item: data }
    })

    app.delete('/v1/admin/manufacturers/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('manufacturers')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true }
    })

    app.get('/v1/admin/formulation-types', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { active } = request.query as { active?: string }
        let query = supabase
            .from('formulation_types')
            .select('*')
            .order('name')

        if (active === 'true') {
            query = query.eq('is_active', true)
        }

        const { data, error } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/package-units', {
        preHandler: requireAdmin
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('package_units')
            .select('*')
            .order('code')

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/crops', {
        preHandler: requireAdmin
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('crops')
            .select('id, name, slug, category_id')
            .order('name')

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/crops/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('crops')
            .select('id, name, slug, category_id')
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Crop not found' })
        }

        return { item: data }
    })

    app.post('/v1/admin/crops', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as { name?: string; slug?: string; category_id?: string | null }

        if (!body.name?.trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('crops')
            .insert({
                name: body.name.trim(),
                slug: normalizeNullable(body.slug) || toSlug(body.name),
                category_id: normalizeNullable(body.category_id)
            })
            .select('id, name, slug, category_id')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create crop' })
        }

        return reply.code(201).send({ item: data })
    })

    app.put('/v1/admin/crops/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as { name?: string; slug?: string; category_id?: string | null }
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.category_id !== undefined ? { category_id: normalizeNullable(body.category_id) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('crops')
            .update(updates)
            .eq('id', id)
            .select('id, name, slug, category_id')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update crop' })
        }

        return { item: data }
    })

    app.delete('/v1/admin/crops/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('crops')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true }
    })

    app.get('/v1/admin/crop-categories', {
        preHandler: requireAdmin
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('crop_categories')
            .select('*')
            .order('name')

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/problems', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { type } = request.query as { type?: string }
        let query = supabase
            .from('problems')
            .select('id, name, slug, type, description')
            .order('type')
            .order('name')

        if (type) {
            query = query.eq('type', type)
        }

        const { data, error } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/problems/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('problems')
            .select('id, name, slug, type, description')
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Problem not found' })
        }

        return { item: data }
    })

    app.post('/v1/admin/problems', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as { name?: string; slug?: string; type?: string; description?: string | null }

        if (!body.name?.trim() || !body.type?.trim()) {
            return reply.code(400).send({ error: 'name and type are required' })
        }

        const { data, error } = await supabase
            .from('problems')
            .insert({
                name: body.name.trim(),
                slug: normalizeNullable(body.slug) || toSlug(body.name),
                type: body.type.trim(),
                description: normalizeNullable(body.description)
            })
            .select('id, name, slug, type, description')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create problem' })
        }

        return reply.code(201).send({ item: data })
    })

    app.put('/v1/admin/problems/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as { name?: string; slug?: string; type?: string; description?: string | null }
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.type !== undefined ? { type: normalizeNullable(body.type) } : {}),
            ...(body.description !== undefined ? { description: normalizeNullable(body.description) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('problems')
            .update(updates)
            .eq('id', id)
            .select('id, name, slug, type, description')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update problem' })
        }

        return { item: data }
    })

    app.delete('/v1/admin/problems/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('problems')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true }
    })

    app.get('/v1/admin/growth-stages', {
        preHandler: requireAdmin
    }, async (_request, reply) => {
        const { data, error } = await supabase
            .from('growth_stages')
            .select('id, name, slug, sort_order')
            .order('sort_order')

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/growth-stages/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('growth_stages')
            .select('id, name, slug, sort_order')
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Growth stage not found' })
        }

        return { item: data }
    })

    app.post('/v1/admin/growth-stages', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as { name?: string; slug?: string; sort_order?: number | null }

        if (!body.name?.trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('growth_stages')
            .insert({
                name: body.name.trim(),
                slug: normalizeNullable(body.slug) || toSlug(body.name),
                sort_order: body.sort_order ?? 0
            })
            .select('id, name, slug, sort_order')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create growth stage' })
        }

        return reply.code(201).send({ item: data })
    })

    app.put('/v1/admin/growth-stages/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as { name?: string; slug?: string; sort_order?: number | null }
        const updates = {
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('growth_stages')
            .update(updates)
            .eq('id', id)
            .select('id, name, slug, sort_order')
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update growth stage' })
        }

        return { item: data }
    })

    app.delete('/v1/admin/growth-stages/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('growth_stages')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true }
    })

    app.get('/v1/admin/product-lines', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { active, manufacturer_id } = request.query as { active?: string; manufacturer_id?: string }
        let query = supabase
            .from('product_lines')
            .select(`
        id,
        manufacturer_id,
        name,
        slug,
        description,
        is_active,
        manufacturers (
          name
        )
      `)
            .order('name')

        if (active === 'true') {
            query = query.eq('is_active', true)
        }

        if (manufacturer_id) {
            query = query.eq('manufacturer_id', manufacturer_id)
        }

        const { data, error } = await query

        if (error) {
            return reply.code(500).send({ error: error.message })
        }

        return { items: data || [] }
    })

    app.get('/v1/admin/product-lines/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { data, error } = await supabase
            .from('product_lines')
            .select(`
        id,
        manufacturer_id,
        name,
        slug,
        description,
        is_active,
        manufacturers (
          name
        )
      `)
            .eq('id', id)
            .single()

        if (error || !data) {
            return reply.code(404).send({ error: 'Product line not found' })
        }

        return { item: data }
    })

    app.post('/v1/admin/product-lines', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const body = request.body as {
            manufacturer_id?: string | null
            name?: string
            slug?: string
            description?: string | null
            is_active?: boolean
        }

        if (!body.name?.trim()) {
            return reply.code(400).send({ error: 'name is required' })
        }

        const { data, error } = await supabase
            .from('product_lines')
            .insert({
                manufacturer_id: normalizeNullable(body.manufacturer_id),
                name: body.name.trim(),
                slug: normalizeNullable(body.slug) || toSlug(body.name),
                description: normalizeNullable(body.description),
                is_active: body.is_active === undefined ? true : Boolean(body.is_active)
            })
            .select(`
        id,
        manufacturer_id,
        name,
        slug,
        description,
        is_active,
        manufacturers (
          name
        )
      `)
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to create product line' })
        }

        return reply.code(201).send({ item: data })
    })

    app.put('/v1/admin/product-lines/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const body = request.body as {
            manufacturer_id?: string | null
            name?: string
            slug?: string
            description?: string | null
            is_active?: boolean
        }
        const updates = {
            ...(body.manufacturer_id !== undefined ? { manufacturer_id: normalizeNullable(body.manufacturer_id) } : {}),
            ...(body.name !== undefined ? { name: normalizeNullable(body.name) } : {}),
            ...(body.slug !== undefined ? { slug: normalizeNullable(body.slug) } : {}),
            ...(body.description !== undefined ? { description: normalizeNullable(body.description) } : {}),
            ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {})
        }

        if (Object.keys(updates).length === 0) {
            return reply.code(400).send({ error: 'No fields to update' })
        }

        const { data, error } = await supabase
            .from('product_lines')
            .update(updates)
            .eq('id', id)
            .select(`
        id,
        manufacturer_id,
        name,
        slug,
        description,
        is_active,
        manufacturers (
          name
        )
      `)
            .single()

        if (error || !data) {
            return reply.code(400).send({ error: error?.message || 'Failed to update product line' })
        }

        return { item: data }
    })

    app.delete('/v1/admin/product-lines/:id', {
        preHandler: requireAdmin
    }, async (request, reply) => {
        const { id } = request.params as { id: string }
        const { error } = await supabase
            .from('product_lines')
            .delete()
            .eq('id', id)

        if (error) {
            return reply.code(400).send({ error: error.message })
        }

        return { ok: true, deleted: true }
    })
}
