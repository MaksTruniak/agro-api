import slugify from 'slugify'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function cleanActiveIngredientName(value: string) {
    return value.replace(/[\s,;]+$/g, '').trim()
}

export function createActiveIngredientSlug(value: string) {
    return slugify(cleanActiveIngredientName(value), {
        lower: true,
        strict: true,
        locale: 'uk'
    })
}

export function isUuid(value: string) {
    return uuidPattern.test(value)
}