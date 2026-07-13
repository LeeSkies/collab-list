import { describe, expect, it } from 'vitest'
import {
  damerauLevenshtein,
  duplicateSignature,
  normalizeNameForStorage,
  normalizeText,
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
  it('uses containment for a one-code-point query', () =>
    expect(searchProducts(products, 'ע').map(({ product }) => product.id)).toContain('1'))
  it('keeps high-confidence Hebrew typos', () =>
    expect(searchProducts(products, 'עגבנית')[0]?.product.id).toBe('1'))
  it('scores contiguous token sequences', () =>
    expect(searchProducts(products, 'סויה')[0]?.product.id).toBe('2'))
  it('excludes low-confidence matches', () => expect(searchProducts(products, 'fork')).toEqual([]))
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
