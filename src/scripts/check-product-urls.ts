import 'dotenv/config'
import { supabase } from '../lib/supabase'

async function main() {
  const { data } = await supabase.from('products').select('source_url').like('source_url', '%pesticidi%').limit(5)
  console.log(JSON.stringify(data, null, 2))
}
main()
