export function clean(value?: string | null) {
    return value?.replace(/\s+/g, ' ').trim() || ''
}

type ActiveIngredient = {
    name: string
    concentration: string | null
}

const CONCENTRATION_UNIT = '(?:г\\/л|г\\/кг|мг\\/л|мг\\/кг|%)'
const CONCENTRATION = `\\d+(?:[,.]\\d+)?\\s*${CONCENTRATION_UNIT}`

function normalizeRawText(value: string) {
    return clean(value)
        .replace(/\(.+?\)/g, '')
        .replace(/\..*$/, '')
}

function normalizeName(value: string) {
    return clean(value)
        .replace(/^[,;:+\s]+/, '')
        .replace(/[,;:+\s]+$/, '')
}

function normalizeConcentration(value: string) {
    return clean(value)
}

export function isValidActiveIngredientName(value?: string | null) {
    const name = clean(value)

    if (!name) return false

    if (/^[0-9]+$/.test(name)) return false

    return true
}

function parsePart(part: string): ActiveIngredient | null {
    const text = clean(part)

    if (!text) return null

    const prefix = text.match(
        new RegExp(`^(${CONCENTRATION})\\s+(.+)$`, 'i')
    )

    if (prefix) {
        return {
            name: normalizeName(prefix[2]),
            concentration: normalizeConcentration(prefix[1])
        }
    }

    const suffix = text.match(
        new RegExp(`^(.+?)\\s*,?\\s*(${CONCENTRATION})$`, 'i')
    )

    if (suffix) {
        return {
            name: normalizeName(suffix[1]),
            concentration: normalizeConcentration(suffix[2])
        }
    }

    return {
        name: normalizeName(text),
        concentration: null
    }
}

export function parseActiveIngredients(value: string): ActiveIngredient[] {
    const text = normalizeRawText(value)

    if (!text) return []

    const parts = text
        .split(/\s*\+\s*|;/)
        .map(clean)
        .filter(Boolean)

    if (parts.length > 1) {
        return parts
            .map(parsePart)
            .filter(Boolean)
            .filter(item => item!.name) as ActiveIngredient[]
    }

    const multiPrefix = [
        ...text.matchAll(
            new RegExp(`(${CONCENTRATION})\\s+([^,+;]+)`, 'gi')
        )
    ]

    if (multiPrefix.length > 1) {
        return multiPrefix
            .map(match => ({
                name: normalizeName(match[2]),
                concentration: normalizeConcentration(match[1])
            }))
            .filter(item => item.name)
    }

    const multiSuffix = [
        ...text.matchAll(
            new RegExp(`([^,+;]+?)\\s*,?\\s*(${CONCENTRATION})`, 'gi')
        )
    ]

    if (multiSuffix.length > 1) {
        return multiSuffix
            .map(match => ({
                name: normalizeName(match[1]),
                concentration: normalizeConcentration(match[2])
            }))
            .filter(item => item.name)
    }

    const single = parsePart(text)

    return single?.name ? [single] : []
}