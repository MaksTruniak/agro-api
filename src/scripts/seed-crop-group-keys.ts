import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  'https://xpoozgcxfjnogzkxmjaw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwb296Z2N4Zmpub2d6a3htamF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzQ0NzAsImV4cCI6MjA5MzgxMDQ3MH0.BJwiGR3oMIIXSSNKGEwcsegnpG9w8OzNMzD1trtoZdg',
  { realtime: { transport: ws as any } }
)

// 16 groups:
// grain        – зернові (пшениця, ячмінь, жито, овес, просо, сорго, гречка)
// corn         – кукурудза (окрема через специфічні фази)
// oilseed      – олійні (соняшник, ріпак, льон)
// legume       – бобові (соя, горох, квасоля, боби)
// technical    – технічні (цукровий буряк, коноплі, хміль, тютюн, льон, лаванда, м'ята)
// veg_nightshade – пасльонові (томат, перець, баклажан, картопля)
// veg_cucurbit   – гарбузові (огірок, кабачок, гарбуз, кавун, диня)
// veg_brassica   – капустяні (капуста всіх видів)
// veg_allium     – цибулеві (цибуля, часник, порей)
// veg_root       – коренеплідні овочі (морква, буряк столовий, пастернак, редиска, редька, ріпа)
// veg_leaf       – листові/зелень (салат, шпинат, кріп, петрушка, базилік, селера, спаржа, артишок)
// berry_shrub    – ягідні кущові (смородина, аґрус, малина, ожина, виноград, горобина, калина, шипшина)
// berry_herb     – ягідні трав'янисті (полуниця, суниця, чорниця, лохина)
// fruit_pome     – зерняткові (яблуня, груша, айва)
// fruit_stone    – кісточкові (слива, вишня, черешня, персик, нектарин, абрикос, кизил, хурма, інжир)
// nut            – горіхові (горіх волоський, ліщина, каштан)

const CROP_GROUP_MAP: Record<string, string> = {
  // grain
  'Пшениця озима':      'grain',
  'Пшениця яра':        'grain',
  'Ячмінь':             'grain',
  'Жито':               'grain',
  'Овес':               'grain',
  'Просо':              'grain',
  'Сорго':              'grain',
  'Гречка':             'grain',

  // corn
  'Кукурудза зернова':  'corn',
  'Кукурудза цукрова':  'corn',

  // oilseed
  'Соняшник':           'oilseed',
  'Ріпак':              'oilseed',

  // legume
  'Соя':                'legume',
  'Горох':              'legume',
  'Квасоля':            'legume',
  'Боби':               'legume',

  // technical
  'Цукровий буряк':     'technical',
  'Коноплі':            'technical',
  'Хміль':              'technical',
  'Тютюн':              'technical',
  'Льон':               'technical',
  'Лаванда':            'technical',
  "М'ята":              'technical',
  'Меліса':             'technical',

  // veg_nightshade
  'Томат':              'veg_nightshade',
  'Перець солодкий':    'veg_nightshade',
  'Перець гострий':     'veg_nightshade',
  'Баклажан':           'veg_nightshade',
  'Картопля':           'veg_nightshade',

  // veg_cucurbit
  'Огірок':             'veg_cucurbit',
  'Кабачок':            'veg_cucurbit',
  'Кабачок цукіні':     'veg_cucurbit',
  'Гарбуз':             'veg_cucurbit',
  'Кавун':              'veg_cucurbit',
  'Диня':               'veg_cucurbit',

  // veg_brassica
  'Капуста білокачанна':  'veg_brassica',
  'Капуста броколі':      'veg_brassica',
  'Капуста брюссельська': 'veg_brassica',
  'Капуста цвітна':       'veg_brassica',
  'Капуста червона':      'veg_brassica',

  // veg_allium
  'Цибуля ріпчаста':    'veg_allium',
  'Цибуля-порей':       'veg_allium',
  'Часник':             'veg_allium',

  // veg_root
  'Морква':             'veg_root',
  'Буряк':              'veg_root',
  'Пастернак':          'veg_root',
  'Редиска':            'veg_root',
  'Редька':             'veg_root',
  'Ріпа':               'veg_root',

  // veg_leaf
  'Салат':              'veg_leaf',
  'Шпинат':             'veg_leaf',
  'Кріп':               'veg_leaf',
  'Петрушка':           'veg_leaf',
  'Базилік':            'veg_leaf',
  'Селера':             'veg_leaf',
  'Спаржа':             'veg_leaf',
  'Артишок':            'veg_leaf',

  // berry_shrub
  'Смородина чорна':    'berry_shrub',
  'Смородина червона':  'berry_shrub',
  'Смородина біла':     'berry_shrub',
  'Аґрус':              'berry_shrub',
  'Малина':             'berry_shrub',
  'Ожина':              'berry_shrub',
  'Виноград столовий':  'berry_shrub',
  'Виноград технічний': 'berry_shrub',
  'Горобина':           'berry_shrub',
  'Калина':             'berry_shrub',
  'Шипшина':            'berry_shrub',

  // berry_herb
  'Полуниця':           'berry_herb',
  'Суниця':             'berry_herb',
  'Чорниця':            'berry_herb',
  'Лохина':             'berry_herb',

  // fruit_pome
  'Яблуня':             'fruit_pome',
  'Груша':              'fruit_pome',
  'Айва':               'fruit_pome',

  // fruit_stone
  'Слива':              'fruit_stone',
  'Вишня':              'fruit_stone',
  'Черешня':            'fruit_stone',
  'Персик':             'fruit_stone',
  'Нектарин':           'fruit_stone',
  'Абрикос':            'fruit_stone',
  'Кизил':              'fruit_stone',
  'Хурма':              'fruit_stone',
  'Інжир':              'fruit_stone',

  // nut
  'Горіх волоський':    'nut',
  'Ліщина':             'nut',
  'Каштан їстівний':    'nut',
}

async function main() {
  const { data: crops, error } = await supabase.from('crop_catalog').select('id, name')
  if (error || !crops) { console.error('Помилка:', error); return }

  let updated = 0
  let skipped = 0

  for (const crop of crops) {
    const group_key = CROP_GROUP_MAP[crop.name]
    if (!group_key) {
      console.log(`⚠️  Немає маппінгу для: "${crop.name}"`)
      skipped++
      continue
    }

    const { error: upErr } = await supabase
      .from('crop_catalog')
      .update({ group_key })
      .eq('id', crop.id)

    if (upErr) console.error(`✗ ${crop.name}:`, upErr.message)
    else { console.log(`✓ ${crop.name} → ${group_key}`); updated++ }
  }

  console.log(`\nГотово! Оновлено: ${updated}, пропущено: ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
