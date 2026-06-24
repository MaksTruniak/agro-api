import 'dotenv/config'
import { supabase } from '../lib/supabase'

const ACTIVE_INGREDIENTS = [
    'бентазон',
    'десмедифам',
    'дифлуфенікан',
    'етофумезат',
    'гліфосат (ізопропіламінна сіль)',
    'імазетапір',
    'квінмерак',
    'клетодим',
    'кломазон',
    'мезотріон',
    'метазахлор',
    'метамітрон',
    'метрибузин',
    'нікосульфурон',
    'оксифлуорфен',
    'пендиметалін',
    'прометрин',
    'пропахізафоп',
    'трибенурон-метил',
    'трифлуралін',
    'фенмедифам',
    'флуроксипір',
    'флурохлоридон',
    'хлортолурон'
] as const

async function main() {
    for (const name of ACTIVE_INGREDIENTS) {
        const { error } = await supabase
            .from('active_ingredients')
            .upsert({
                name
            }, {
                onConflict: 'name'
            })

        if (error) {
            console.error(`Failed: ${name}`)
            console.error(error)
            process.exit(1)
        }

        console.log(`Upserted: ${name}`)
    }

    console.log(`Done. Total: ${ACTIVE_INGREDIENTS.length}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
