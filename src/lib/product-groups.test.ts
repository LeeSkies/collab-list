import { describe, expect, it } from 'vitest'
import { buildProductGroups } from './product-groups'
import { PRODUCT_CATEGORIES, type ProductCategory } from './product-category'

interface Fixture {
  id: string
  name: string
  category: ProductCategory
}

const item = (id: string, category: ProductCategory): Fixture => ({ id, name: id, category })

const labels = new Map([
  ['category_fruit_vegetables', 'Fruit & vegetables'],
  ['category_dairy_eggs', 'Dairy & eggs'],
  ['category_meat_fish', 'Meat & fish'],
  ['category_bakery', 'Bakery'],
  ['category_pantry', 'Pantry'],
  ['category_frozen', 'Frozen'],
  ['category_drinks', 'Drinks'],
  ['category_snacks', 'Snacks'],
  ['category_household', 'Household'],
  ['category_other', 'Other']
])

const t = (key: string) => labels.get(key) ?? key

describe('buildProductGroups', () => {
  it('keeps the fixed category order even when products arrive in a different order', () => {
    const products = [
      item('snacks-1', 'snacks'),
      item('fruit-1', 'fruit_vegetables'),
      item('dairy-1', 'dairy_eggs'),
      item('other-1', 'other')
    ]
    const groups = buildProductGroups(products, t, true)

    expect(groups.map((group) => group.key)).toEqual([
      'fruit_vegetables',
      'dairy_eggs',
      'snacks',
      'other'
    ])
    // Empty categories in between stay omitted.
    expect(groups.map((group) => group.key)).not.toContain('meat_fish')
  })

  it('omits every empty category', () => {
    const groups = buildProductGroups([item('other-1', 'other')], t, true)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('other')
    expect(groups[0]!.products).toHaveLength(1)
  })

  it('resolves localized headings through the translation lookup', () => {
    const products = [item('dairy-1', 'dairy_eggs'), item('bakery-1', 'bakery')]
    const groups = buildProductGroups(products, t, true)

    expect(groups.map((group) => group.label)).toEqual(['Dairy & eggs', 'Bakery'])
  })

  it('keeps product ordering inside a group unchanged', () => {
    const products = [item('b', 'snacks'), item('a', 'snacks'), item('c', 'snacks')]
    const [group] = buildProductGroups(products, t, true)

    expect(group!.products.map((product) => product.id)).toEqual(['b', 'a', 'c'])
  })

  it('reports the correct group count', () => {
    const groups = buildProductGroups(
      [item('a', 'snacks'), item('b', 'snacks'), item('c', 'bakery')],
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
    const groups = buildProductGroups(products, t, false)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('all')
    expect(groups[0]!.label).toBe('')
    expect(groups[0]!.products).toEqual(products)
  })

  it('is independent of animation mode and rendering concerns', () => {
    const products = [item('a', 'fruit_vegetables')]
    // Identical input produces identical grouping; animation decisions are
    // deliberately not part of this seam.
    expect(buildProductGroups(products, t, true)).toEqual(buildProductGroups(products, t, true))
    expect(buildProductGroups(products, t, true)[0]!.key).toBe('fruit_vegetables')
  })

  it('covers every category in the fixed taxonomy', () => {
    // All ten categories are represented so the section never drops a group.
    expect(PRODUCT_CATEGORIES).toHaveLength(10)
    expect(new Set(PRODUCT_CATEGORIES).size).toBe(10)
  })
})
