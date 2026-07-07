import 'dotenv/config'
import { supabase } from '../lib/supabase'

// Нормалізуємо назву для порівняння
function normalize(name: string) {
  return name.toLowerCase().trim().replace(/[-–—]\s*$/, '').trim()
}

async function main() {
  const { data: all, error } = await supabase
    .from('active_ingredients')
    .select('id, name, description')
    .order('name')

  if (error || !all) { console.error(error); return }

  // Групуємо за нормалізованою назвою
  const groups = new Map<string, typeof all>()
  for (const r of all) {
    const key = normalize(r.name)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const dups = [...groups.entries()].filter(([_, v]) => v.length > 1)
  console.log(`Знайдено ${dups.length} груп дублікатів`)

  let merged = 0
  let errors = 0

  for (const [key, variants] of dups) {
    // Канонічна версія: та що має description, або та з великої літери, або перша
    const canonical = variants.find(v => v.description)
      || variants.find(v => v.name[0] === v.name[0].toUpperCase())
      || variants[0]

    const dupes = variants.filter(v => v.id !== canonical.id)

    console.log(`\n"${key}": зберігаємо "${canonical.name}"`)
    for (const dup of dupes) {
      console.log(`  → видаляємо "${dup.name}" (${dup.id})`)

      // Переносимо зв'язки з препаратами на канонічний запис
      const { data: links } = await supabase
        .from('product_active_ingredients')
        .select('id, product_id')
        .eq('active_ingredient_id', dup.id)

      for (const link of links || []) {
        // Перевіряємо чи такий зв'язок вже є у канонічного
        const { data: existing } = await supabase
          .from('product_active_ingredients')
          .select('id')
          .eq('active_ingredient_id', canonical.id)
          .eq('product_id', link.product_id)
          .single()

        if (existing) {
          // Дублікат зв'язку — просто видаляємо
          await supabase.from('product_active_ingredients').delete().eq('id', link.id)
        } else {
          // Перемаємо зв'язок на канонічний
          await supabase.from('product_active_ingredients')
            .update({ active_ingredient_id: canonical.id })
            .eq('id', link.id)
        }
      }

      // Видаляємо дублікат
      const { error: delErr } = await supabase
        .from('active_ingredients')
        .delete()
        .eq('id', dup.id)

      if (delErr) {
        console.error(`    ✗ помилка видалення:`, delErr.message)
        errors++
      } else {
        merged++
      }
    }
  }

  console.log(`\nГотово: злито ${merged} дублікатів, помилок: ${errors}`)

  // Фінальний count
  const { count } = await supabase
    .from('active_ingredients')
    .select('*', { count: 'exact', head: true })
  console.log(`Залишилось записів: ${count}`)
}

main().catch(e => { console.error(e); process.exit(1) })
