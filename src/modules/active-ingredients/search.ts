import { supabase } from '../../lib/supabase'

export function normalizeIngredientName(value: string) {
    return value
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/ʼ|’|`/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

export async function findActiveIngredientIds(names: string[]) {
    const normalized = names
        .map(normalizeIngredientName)
        .filter(Boolean)

    if (!normalized.length) return []

    const { data, error } = await supabase
        .from('active_ingredient_aliases')
        .select('active_ingredient_id, alias, normalized_alias')
        .in('normalized_alias', normalized)

    if (error) throw error

    return data?.map(item => item.active_ingredient_id) || []
}