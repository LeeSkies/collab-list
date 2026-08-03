import { describe, expect, it } from 'vitest'
import {
  applyAuthoritativeProduct,
  ProductMutationCoordinator,
  rollbackOptimisticProduct
} from './product-mutation-coordinator'

describe('ProductMutationCoordinator', () => {
  it('allows different products concurrently and releases each independently', () => {
    const coordinator = new ProductMutationCoordinator()

    expect(coordinator.lockProduct('a')).toBe(true)
    expect(coordinator.lockProduct('b')).toBe(true)
    expect(coordinator.lockProduct('a')).toBe(false)

    coordinator.unlockProduct('a')
    expect(coordinator.snapshot().productIds).toEqual(new Set(['b']))
    expect(coordinator.lockProduct('a')).toBe(true)
  })

  it('makes Restore All exclusive with every product mutation', () => {
    const coordinator = new ProductMutationCoordinator()

    expect(coordinator.lockProduct('a')).toBe(true)
    expect(coordinator.lockBulk()).toBe(false)
    coordinator.unlockProduct('a')

    expect(coordinator.lockBulk()).toBe(true)
    expect(coordinator.lockBulk()).toBe(false)
    expect(coordinator.lockProduct('a')).toBe(false)

    coordinator.unlockBulk()
    expect(coordinator.lockProduct('a')).toBe(true)
  })
})

describe('rollbackOptimisticProduct', () => {
  it('restores only its own optimistic revision and preserves unrelated changes', () => {
    const previousA = { id: 'a', version: 1 }
    const optimisticA = { id: 'a', version: 2 }
    const successfulB = { id: 'b', version: 4 }

    expect(rollbackOptimisticProduct([optimisticA, successfulB], optimisticA, previousA)).toEqual([
      previousA,
      successfulB
    ])
  })

  it('reverts a recreated object for the same id and version (identity-independent)', () => {
    // Realtime/cache replacement can hand back new objects for the same product.
    const previous = { id: 'a', version: 1 }
    const optimistic = { id: 'a', version: 2 }
    const echo = { id: 'a', version: 2, name: 'reconstructed echo' }

    expect(rollbackOptimisticProduct([echo], optimistic, previous)).toEqual([previous])
  })

  it('does not overwrite an authoritative replacement at a newer revision', () => {
    const previous = { id: 'a', version: 1 }
    const optimistic = { id: 'a', version: 2 }
    const authoritative = { id: 'a', version: 3, picked: true }

    expect(rollbackOptimisticProduct([authoritative], optimistic, previous)).toEqual([
      authoritative
    ])
  })

  it('does not resurrect a row that no longer carries the optimistic revision', () => {
    const previous = { id: 'a', version: 1 }
    const optimistic = { id: 'a', version: 2 }
    const unrelated = { id: 'b', version: 5 }

    // The optimistic row is gone; a stale failure must not insert it back.
    expect(rollbackOptimisticProduct([unrelated], optimistic, previous)).toEqual([unrelated])
  })
})

describe('applyAuthoritativeProduct', () => {
  it('replaces the row by id when an authoritative result is the current revision', () => {
    const current = { id: 'a', version: 2, name: 'before' }
    const authoritative = { id: 'a', version: 3, name: 'picked' }

    expect(applyAuthoritativeProduct([current], authoritative)).toEqual([authoritative])
  })

  it('is idempotent for a realtime echo that already carries the same version', () => {
    const authoritative = { id: 'a', version: 3, name: 'picked' }

    // A duplicate echo of the same toggle must not double-apply or regress state.
    expect(applyAuthoritativeProduct([authoritative], authoritative)).toEqual([authoritative])
  })

  it('never lets a stale success regress a newer authoritative revision', () => {
    const stale = { id: 'a', version: 2, name: 'stale-undo' }
    const newer = { id: 'a', version: 3, name: 'picked' }

    expect(applyAuthoritativeProduct([newer], stale)).toEqual([newer])
  })

  it('preserves unrelated rows while applying the authoritative row by identity', () => {
    const currentA = { id: 'a', version: 2 }
    const keepB = { id: 'b', version: 5 }
    const authoritative = { id: 'a', version: 3 }

    expect(applyAuthoritativeProduct([currentA, keepB], authoritative)).toEqual([
      authoritative,
      keepB
    ])
  })
})

describe('quantity reconciliation', () => {
  it('settles rapid quantity changes on the latest authoritative revision', () => {
    const first = { id: 'a', version: 2, quantity: '2.00' }
    const second = { id: 'a', version: 3, quantity: '3.00' }

    // A rapid plus that wins keeps its revision even if an older echo arrives later.
    expect(applyAuthoritativeProduct([first], second)).toEqual([second])
    expect(applyAuthoritativeProduct([second], first)).toEqual([second])
  })

  it('does not double-apply a duplicate realtime echo of the same quantity change', () => {
    const echo = { id: 'a', version: 3, quantity: '3.00' }

    expect(applyAuthoritativeProduct([echo], echo)).toEqual([echo])
  })

  it('a failed quantity change restores only its own optimistic revision', () => {
    const previous = { id: 'a', version: 1, quantity: '1.00' }
    const optimistic = { id: 'a', version: 2, quantity: '2.00' }
    const authoritative = { id: 'a', version: 3, quantity: '3.00' }

    expect(rollbackOptimisticProduct([optimistic], optimistic, previous)).toEqual([previous])
    // A stale failure must not resurrect its revision over a newer authoritative row.
    expect(rollbackOptimisticProduct([authoritative], optimistic, previous)).toEqual([
      authoritative
    ])
  })
})
