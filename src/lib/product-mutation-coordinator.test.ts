import { describe, expect, it } from 'vitest'
import {
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
