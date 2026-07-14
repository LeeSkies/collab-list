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
  it('restores only its own optimistic object and preserves unrelated changes', () => {
    const previousA = { id: 'a', version: 1 }
    const optimisticA = { id: 'a', version: 2 }
    const successfulB = { id: 'b', version: 4 }

    expect(rollbackOptimisticProduct([optimisticA, successfulB], optimisticA, previousA)).toEqual([
      previousA,
      successfulB
    ])
  })

  it('does not overwrite an authoritative replacement of the optimistic object', () => {
    const previous = { id: 'a', version: 1 }
    const optimistic = { id: 'a', version: 2 }
    const authoritative = { id: 'a', version: 3 }

    expect(rollbackOptimisticProduct([authoritative], optimistic, previous)).toEqual([
      authoritative
    ])
  })
})
