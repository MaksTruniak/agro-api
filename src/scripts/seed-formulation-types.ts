import 'dotenv/config'
import { supabase } from '../lib/supabase'

const FORMULATION_TYPES = [
    { code: 'WG', name: 'ВГ (гранули, що диспергуються у воді)' },
    { code: 'EW', name: 'ЕВ (емульсія, масло (олія) у воді)' },
    { code: 'EC', name: 'КЕ (концентрат, що емульгується)' },
    { code: 'SC', name: 'КС (концентрат суспензії)' },
    { code: 'OD', name: 'МД (масляна дисперсія)' },
    { code: 'ME', name: 'МЕ (мікроемульсія)' },
    { code: 'OF', name: 'МС (концентрат, який тече, що змішується з маслом (олією) (суспензія, що змішується з маслом (олією)))' },
    { code: 'OIL', name: 'олія' },
    { code: 'SL', name: 'РК (розчинний концентрат)' },
    { code: 'SE', name: 'СЕ (суспо-емульсія)' },
    { code: 'CS', name: 'СК (капсульна суспензія)' },
    { code: 'FS', name: 'ТН (концентрат, який тече, для обробки насіння)' },
    { code: 'SC+CS', name: 'ФК (змішана препаративна форма КС і СК)' }
] as const

async function main() {
    for (const item of FORMULATION_TYPES) {
        const { error } = await supabase
            .from('formulation_types')
            .upsert({
                code: item.code,
                name: item.name,
                is_active: true
            }, {
                onConflict: 'code'
            })

        if (error) {
            console.error(`Failed: ${item.code}`)
            console.error(error)
            process.exit(1)
        }

        console.log(`Upserted: ${item.code} -> ${item.name}`)
    }

    console.log(`Done. Total: ${FORMULATION_TYPES.length}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
