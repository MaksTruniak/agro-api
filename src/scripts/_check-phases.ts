import 'dotenv/config'
import { supabase } from '../lib/supabase'

async function main() {
  // Supabase AgroPoradnyk (інша БД — беремо .env з AgroPoradnykWeb)
  const { createClient } = await import('@supabase/supabase-js')
  const ws = (await import('ws')).default
  const sb = createClient(
    'https://xpoozgcxfjnogzkxmjaw.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwb296Z2N4Zmpub2d6a3htamF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzQ0NzAsImV4cCI6MjA5MzgxMDQ3MH0.BJwiGR3oMIIXSSNKGEwcsegnpG9w8OzNMzD1trtoZdg',
    { realtime: { transport: ws as any } }
  )
  const { data, error } = await sb.from('growth_phases').select('*').order('order_num')
  if (error) { console.error(error); return }
  console.log('Всього фаз:', data?.length)
  console.log('\nКолонки:', Object.keys(data?.[0] || {}))
  data?.forEach(r => console.log(r.order_num, r.emoji, `"${r.key}"`, '| crop_group:', r.crop_group ?? 'NULL'))
}
main()
