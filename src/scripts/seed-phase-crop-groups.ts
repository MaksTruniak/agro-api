import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  'https://xpoozgcxfjnogzkxmjaw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwb296Z2N4Zmpub2d6a3htamF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzQ0NzAsImV4cCI6MjA5MzgxMDQ3MH0.BJwiGR3oMIIXSSNKGEwcsegnpG9w8OzNMzD1trtoZdg',
  { realtime: { transport: ws as any } }
)

// Groups used:
// grain, corn, oilseed, legume, technical
// veg_nightshade, veg_cucurbit, veg_brassica, veg_allium, veg_root, veg_leaf
// berry_shrub, berry_herb
// fruit_pome, fruit_stone, nut

const VEG_ALL = ['veg_nightshade', 'veg_cucurbit', 'veg_brassica', 'veg_allium', 'veg_root', 'veg_leaf']
const BERRY_ALL = ['berry_shrub', 'berry_herb']
const FRUIT_ALL = ['fruit_pome', 'fruit_stone', 'nut']
const PERENNIAL = [...BERRY_ALL, ...FRUIT_ALL]

const PHASE_GROUPS: Record<string, string[]> = {
  'Сходи':                              ['grain', 'corn', 'oilseed', 'legume', 'technical', ...VEG_ALL],
  'Спокій':                             PERENNIAL,
  'Кущення':                            ['grain'],
  'Проростання / Набрякання бруньок':   PERENNIAL,
  'Розвиток листя':                     [...PERENNIAL, ...VEG_ALL],
  'Вихід в трубку':                     ['grain'],
  'Розвиток пагонів / Кущіння':         PERENNIAL,
  'Колосіння':                          ['grain'],
  'Активний ріст':                      ['corn', 'oilseed', 'legume', 'technical', ...VEG_ALL],
  'Наливання зерна':                    ['grain', 'corn'],
  'Бутонізація':                        ['oilseed', 'legume', 'technical', ...VEG_ALL],
  'Цвітіння':                           ['grain', 'corn', 'oilseed', 'legume', 'technical', ...VEG_ALL, ...PERENNIAL],
  'Після цвітіння':                     PERENNIAL,
  'Формування плодів':                  ['corn', 'oilseed', 'legume', 'technical', ...VEG_ALL, ...PERENNIAL],
  'Налив плодів':                       [...VEG_ALL, ...PERENNIAL],
  'Дозрівання':                         ['grain', 'corn', 'oilseed', 'legume', 'technical', ...VEG_ALL, ...PERENNIAL],
  'Збір урожаю':                        ['grain', 'corn', 'oilseed', 'legume', 'technical', ...VEG_ALL, ...PERENNIAL],
  'Після збору':                        ['grain', 'corn', 'oilseed', 'legume', 'technical', ...VEG_ALL, ...PERENNIAL],
  'Підготовка до зими':                 PERENNIAL,
  'До початку розпускання листків':     PERENNIAL,
  'Початок розпускання бруньок':        PERENNIAL,
}

async function main() {
  const { data: phases } = await supabase.from('growth_phases').select('id, key')
  if (!phases) { console.error('Фази не знайдено'); return }

  for (const phase of phases) {
    const groups = PHASE_GROUPS[phase.key]
    if (!groups) {
      console.log(`⚠️  Немає маппінгу для: "${phase.key}"`)
      continue
    }
    const { error } = await supabase
      .from('growth_phases')
      .update({ crop_groups: groups })
      .eq('id', phase.id)

    if (error) console.error(`✗ ${phase.key}:`, error.message)
    else console.log(`✓ ${phase.key} → [${groups.join(', ')}]`)
  }
  console.log('\nГотово!')
}

main().catch(e => { console.error(e); process.exit(1) })
