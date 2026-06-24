import 'dotenv/config'
import { supabase } from '../lib/supabase'
import { generateApiKey, hashApiKey } from '../modules/auth/api-key'

async function main() {
    const clientId = '29733c94-a0fe-4b28-ad3c-48251d6f57f3'

    const apiKey = generateApiKey()
    const keyHash = hashApiKey(apiKey)

    const { error } = await supabase
        .from('api_keys')
        .insert({
            client_id: clientId,
            prefix: 'agp_live',
            key_hash: keyHash,
            is_active: true
        })

    if (error) {
        console.error(error)
        process.exit(1)
    }

    console.log('\nAPI KEY:')
    console.log(apiKey)
}

main()