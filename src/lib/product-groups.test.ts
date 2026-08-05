import { describe, expect, it } from 'vitest'
import { buildProductGroups } from './product-groups'
import { SEED_CATEGORY_NAMES } from './product-category'
import type { Category } from './types'

interface Fixture {
  id: string
  name: string
  category_id: string
}

const item = (id: string, categoryId: string): Fixture => ({
  id,
  name: id,
  category_id: categoryId
})

const category = (id: string, name: string): Category => ({
  id,
  household_id: '20000000-0000-0000-0000-000000000001',
  name
})

// The household's categories arrive sorted by name from the API, matching how
// the database orders them.
const categories: Category[] = [
  category('bakery', 'bakery'),
  category('dairy_eggs', 'dairy_eggs'),
  category('snacks', 'snacks'),
  category('other', 'other')
]

const labels = new Map([
  ['category_bakery', 'Bakery'],
  ['category_dairy_eggs', 'Dairy & eggs'],
  ['category_snacks', 'Snacks'],
  ['category_other', 'Other']
])

const t = (key: string) => labels.get(key) ?? key

describe('buildProductGroups', () => {
  it('orders groups by the household category names', () => {
    const products = [
      item('snacks-1', 'snacks'),
      item('bakery-1', 'bakery'),
      item('dairy-1', 'dairy_eggs'),
      item('other-1', 'other')
    ]
    const groups = buildProductGroups(products, categories, t, true)

    expect(groups.map((group) => group.key)).toEqual(['bakery', 'dairy_eggs', 'snacks', 'other'])
  })

  it('omits empty categories', () => {
    const groups = buildProductGroups([item('other-1', 'other')], categories, t, true)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('other')
    expect(groups[0]!.products).toHaveLength(1)
  })

  it('resolves localized headings through the translation lookup', () => {
    const products = [item('dairy-1', 'dairy_eggs'), item('bakery-1', 'bakery')]
    const groups = buildProductGroups(products, categories, t, true)

    expect(groups.map((group) => group.label)).toEqual(['Bakery', 'Dairy & eggs'])
  })

  it('falls back to the stored name for custom categories', () => {
    const customCategories = [category('custom', 'Cheese & Charcuterie'), ...categories]
    const groups = buildProductGroups([item('cheese-1', 'custom')], customCategories, t, true)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('Cheese & Charcuterie')
  })

  it('keeps product ordering inside a group unchanged', () => {
    const products = [item('b', 'snacks'), item('a', 'snacks'), item('c', 'snacks')]
    const [group] = buildProductGroups(products, categories, t, true)

    expect(group!.products.map((product) => product.id)).toEqual(['b', 'a', 'c'])
  })

  it('reports the correct group count', () => {
    const groups = buildProductGroups(
      [item('a', 'snacks'), item('b', 'snacks'), item('c', 'bakery')],
      categories,
      t,
      true
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]!.key).toBe('bakery')
    expect(groups[0]!.products).toHaveLength(1)
    expect(groups[1]!.key).toBe('snacks')
    expect(groups[1]!.products).toHaveLength(2)
  })

  it('returns a single unnamed group in flat mode', () => {
    const products = [item('a', 'bakery'), item('b', 'snacks')]
    const groups = buildProductGroups(products, categories, t, false)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('all')
    expect(groups[0]!.label).toBe('')
    expect(groups[0]!.products).toEqual(products)
  })

  it('is independent of animation mode and rendering concerns', () => {
    const products = [item('a', 'bakery')]
    // Identical input produces identical grouping; animation decisions are
    // deliberately not part of this seam.
    expect(buildProductGroups(products, categories, t, true)).toEqual(
      buildProductGroups(products, categories, t, true)
    )
    expect(buildProductGroups(products, categories, t, true)[0]!.key).toBe('bakery')
  })

  it('keeps the ten seeded names available for fixture coverage', () => {
    // The built-in taxonomy still exists as seed names so every household
    // starts with the same ten categories.
    expect(SEED_CATEGORY_NAMES).toHaveLength(10)
    expect(new Set(SEED_CATEGORY_NAMES).size).toBe(10)
  })
})
