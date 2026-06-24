import 'dotenv/config'
import { supabase } from '../lib/supabase'
import { clean, parseActiveIngredients } from '../shared/parse-active-ingredients'

type BadRow = {
    product_id: string
    active_ingredient_id: string
    concentration: string | null
    active_ingredients: {
        name: string
    } | null
}

function parseActiveParts(name: string, concentration?: string | null) {
    const full = clean(concentration ? `${name} ${concentration}` : name)
    const parts = parseActiveIngredients(full)

    return parts.length > 1 ? parts : []
}

async function upsertActiveIngredient(name: string) {
    const { data, error } = await supabase
        .from('active_ingredients')
        .upsert({
            name
        }, {
            onConflict: 'name'
        })
        .select('id')
        .single()

    if (error) throw error

    return data.id as string
}

async function main() {
    const { data, error } = await supabase
        .from('product_active_ingredients')
        .select(`
      product_id,
      active_ingredient_id,
      concentration,
      active_ingredients (
        name
      )
    `)

    if (error) throw error

    const rows = (data || []) as unknown as BadRow[]

    let fixed = 0

    for (const row of rows) {
        const activeName = clean(row.active_ingredients?.name)
        if (!activeName) continue

        const parts = parseActiveParts(activeName, row.concentration)

        if (parts.length <= 1) continue

        console.log('\nFIX:', activeName, row.concentration || '')
        console.log(parts)

        for (const part of parts) {
            const activeIngredientId = await upsertActiveIngredient(part.name)

            const { error: insertError } = await supabase
                .from('product_active_ingredients')
                .upsert({
                    product_id: row.product_id,
                    active_ingredient_id: activeIngredientId,
                    concentration: part.concentration
                }, {
                    onConflict: 'product_id,active_ingredient_id'
                })

            if (insertError) throw insertError
        }

        const { error: deleteError } = await supabase
            .from('product_active_ingredients')
            .delete()
            .eq('product_id', row.product_id)
            .eq('active_ingredient_id', row.active_ingredient_id)

        if (deleteError) throw deleteError

        fixed++
    }

    console.log(`\nDone. Fixed rows: ${fixed}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
