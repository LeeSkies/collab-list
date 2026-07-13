export const PRODUCT_NAME_MAX = 80
export const PRODUCT_NOTES_MAX = 500
export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 999
export const SEARCH_THRESHOLD = 0.72

const tokenPattern = /[\p{L}\p{N}]+/gu

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

export function normalizeNameForStorage(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function duplicateSignature(value: string): string {
  const tokens = normalizeText(value).match(tokenPattern) ?? []
  return tokens
    .sort((a, b) => codePointCompare(a, b))
    .map((token) => `${[...token].length}:${token}`)
    .join('|')
}

export function damerauLevenshtein(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  const rows = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
      }
    }
  }
  return rows[a.length]![b.length]!
}

export function similarity(left: string, right: string): number {
  const max = Math.max([...left].length, [...right].length)
  return max === 0 ? 1 : 1 - damerauLevenshtein(left, right) / max
}

export interface SearchableProduct {
  id: string
  name: string
}

export interface ScoredProduct<T extends SearchableProduct> {
  product: T
  score: number
}

export function searchProducts<T extends SearchableProduct>(
  products: T[],
  query: string
): ScoredProduct<T>[] {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return products.map((product) => ({ product, score: 1 }))
  const queryLength = [...normalizedQuery].length

  return products
    .map((product) => {
      const candidate = normalizeText(product.name)
      const tokens = candidate.split(' ')
      if (queryLength === 1) {
        const prefix = tokens.some((token) => token.startsWith(normalizedQuery))
        const contains = tokens.some((token) => token.includes(normalizedQuery))
        return { product, score: prefix ? 1 : contains ? 0.9 : 0 }
      }
      const sequences = contiguousSequences(tokens)
      const score = Math.max(
        similarity(normalizedQuery, candidate),
        ...sequences.map((part) => similarity(normalizedQuery, part))
      )
      return { product, score }
    })
    .filter(({ score }) => score >= SEARCH_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        codePointCompare(normalizeText(a.product.name), normalizeText(b.product.name)) ||
        codePointCompare(a.product.id, b.product.id)
    )
}

function contiguousSequences(tokens: string[]): string[] {
  const output: string[] = []
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1)
      output.push(tokens.slice(start, end).join(' '))
  }
  return output
}

function codePointCompare(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  const size = Math.min(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    const difference = left[index]!.codePointAt(0)! - right[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

export function validateQuantity(value: string | number): string | null {
  const text = String(value).trim()
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return 'precision'
  const numeric = Number(text)
  if (numeric < QUANTITY_MIN || numeric > QUANTITY_MAX) return 'range'
  return null
}

export function quantityCanAdjust(value: string | number, delta: 1 | -1): boolean {
  const result = Number(value) + delta
  return result >= QUANTITY_MIN && result <= QUANTITY_MAX
}
