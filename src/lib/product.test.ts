import { describe, expect, it } from 'vitest'
import {
  damerauLevenshtein,
  duplicateSignature,
  normalizeNameForStorage,
  normalizeText,
  orderProductSections,
  quantityCanAdjust,
  searchProducts,
  similarity,
  validateQuantity
} from './product'

describe('product duplicate identity', () => {
  it.each([
    ['soy milk', 'Milk Soy'],
    ['soy milk', 'soy-milk'],
    ['חלב סויה', 'סויה, חלב'],
    ['MILK', 'milk']
  ])('treats %s and %s as duplicates', (left, right) =>
    expect(duplicateSignature(left)).toBe(duplicateSignature(right))
  )
  it('retains repeated token counts', () =>
    expect(duplicateSignature('milk milk')).not.toBe(duplicateSignature('milk')))
  it('normalizes Unicode compatibility forms', () =>
    expect(normalizeText('  ＭＩＬＫ  ')).toBe('milk'))
  it('preserves display casing while collapsing whitespace', () =>
    expect(normalizeNameForStorage('  Soy   Milk ')).toBe('Soy Milk'))
})

describe('fuzzy search', () => {
  const products = [
    { id: '1', name: 'עגבניות' },
    { id: '2', name: 'חלב סויה' },
    { id: '3', name: 'Soy milk' },
    { id: '4', name: 'Bread' }
  ]
  it('supports adjacent transpositions', () => expect(damerauLevenshtein('milk', 'mlik')).toBe(1))
  it('scores identical values as one', () => expect(similarity('חלב', 'חלב')).toBe(1))
  it.each([
    ['so', '3'],
    ['חלב ס', '2'],
    ['ＳＯＹ—Ｍ', '3']
  ])('uses normalized literal matching for the short query %s', (query, expectedId) =>
    expect(searchProducts(products, query).map(({ product }) => product.id)).toContain(expectedId)
  )
  it('uses containment for a one-code-point query', () =>
    expect(searchProducts(products, 'ע').map(({ product }) => product.id)).toContain('1'))
  it('ranks prefix matches before containment and fuzzy-only matches', () => {
    const ranked = searchProducts(
      [
        { id: 'prefix', name: 'Milk chocolate' },
        { id: 'contains', name: 'Buttermilk' },
        { id: 'fuzzy', name: 'Mlik' }
      ],
      'milk'
    )
    expect(ranked.map(({ product }) => product.id)).toEqual(['prefix', 'contains', 'fuzzy'])
  })
  it('orders literal-tier ties by normalized name and then product ID', () => {
    const ranked = searchProducts(
      [
        { id: 'z', name: 'Zoo milk' },
        { id: 'b', name: 'Alpha milk' },
        { id: 'a', name: 'Alpha milk' }
      ],
      'milk'
    )
    expect(ranked.map(({ product }) => product.id)).toEqual(['a', 'b', 'z'])
  })
  it('orders fuzzy-only matches by descending similarity', () => {
    const ranked = searchProducts(
      [
        { id: 'lower', name: 'tomato' },
        { id: 'higher', name: 'tomatos' }
      ],
      'tomatoes'
    )
    expect(ranked.map(({ product }) => product.id)).toEqual(['higher', 'lower'])
  })
  it('keeps high-confidence Hebrew typos', () =>
    expect(searchProducts(products, 'עגבנית')[0]?.product.id).toBe('1'))
  it('scores contiguous token sequences', () =>
    expect(searchProducts(products, 'סויה')[0]?.product.id).toBe('2'))
  it('excludes low-confidence matches', () => expect(searchProducts(products, 'fork')).toEqual([]))
})

describe('product section ordering', () => {
  const products = [
    {
      id: 'unpicked-fuzzy',
      name: 'Mlik',
      is_picked: false,
      ordering_at: '2026-07-14T00:00:00Z',
      picked_at: null
    },
    {
      id: 'unpicked-prefix',
      name: 'Milk chocolate',
      is_picked: false,
      ordering_at: '2026-07-13T00:00:00Z',
      picked_at: null
    },
    {
      id: 'picked-fuzzy',
      name: 'Mlik',
      is_picked: true,
      ordering_at: '2026-07-14T00:00:00Z',
      picked_at: '2026-07-14T00:00:00Z'
    },
    {
      id: 'picked-prefix',
      name: 'Milk chocolate',
      is_picked: true,
      ordering_at: '2026-07-13T00:00:00Z',
      picked_at: '2026-07-13T00:00:00Z'
    }
  ]

  it('preserves relevance order within separate picked states while searching', () => {
    const sections = orderProductSections(products, 'milk')
    expect(sections.unpicked.map(({ id }) => id)).toEqual(['unpicked-prefix', 'unpicked-fuzzy'])
    expect(sections.picked.map(({ id }) => id)).toEqual(['picked-prefix', 'picked-fuzzy'])
  })

  it('uses chronological section ordering when search is empty', () => {
    const sections = orderProductSections(products, '')
    expect(sections.unpicked.map(({ id }) => id)).toEqual(['unpicked-fuzzy', 'unpicked-prefix'])
    expect(sections.picked.map(({ id }) => id)).toEqual(['picked-fuzzy', 'picked-prefix'])
  })
})

describe('quantity rules', () => {
  it.each(['1', '1.25', '999', '999.00'])(`accepts %s`, (value) =>
    expect(validateQuantity(value)).toBeNull()
  )
  it.each(['0.99', '1000', '1.234', '-1', 'abc'])(`rejects %s`, (value) =>
    expect(validateQuantity(value)).not.toBeNull()
  )
  it('prevents decrement below one', () => expect(quantityCanAdjust('1.5', -1)).toBe(false))
  it('prevents increment above 999', () => expect(quantityCanAdjust('998.5', 1)).toBe(false))
})
