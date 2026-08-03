import { describe, expect, it } from 'vitest'
import {
  HOLD_DELAY_MS,
  MOVE_TOLERANCE_PX,
  SWIPE_THRESHOLD_PX,
  holdCancelsOnMovement,
  swipeDecision
} from './hold-gesture'

describe('holdCancelsOnMovement', () => {
  it('keeps a still or drifting press inside the tolerance as a hold', () => {
    expect(holdCancelsOnMovement(0, 0)).toBe(false)
    expect(holdCancelsOnMovement(MOVE_TOLERANCE_PX, 0)).toBe(false)
    expect(holdCancelsOnMovement(0, MOVE_TOLERANCE_PX)).toBe(false)
  })

  it('cancels a press that drifts beyond the tolerance horizontally', () => {
    expect(holdCancelsOnMovement(MOVE_TOLERANCE_PX + 1, 0)).toBe(true)
    expect(holdCancelsOnMovement(-MOVE_TOLERANCE_PX - 1, 0)).toBe(true)
  })

  it('cancels a press on diagonal movement, keeping ambiguous gestures predictable', () => {
    // 8px each way exceeds the 10px tolerance even though neither axis does alone.
    expect(holdCancelsOnMovement(8, 8)).toBe(true)
    // 6px each way stays inside the tolerance.
    expect(holdCancelsOnMovement(6, 6)).toBe(false)
  })

  it('uses the configured delay as the hold duration', () => {
    expect(HOLD_DELAY_MS).toBe(360)
  })
})

describe('swipeDecision', () => {
  it('commits a swipe once the offset passes the threshold in the swipe direction', () => {
    expect(swipeDecision(-SWIPE_THRESHOLD_PX, -1)).toBe('toggle')
    expect(swipeDecision(SWIPE_THRESHOLD_PX, 1)).toBe('toggle')
  })

  it('returns the row to rest below the threshold', () => {
    expect(swipeDecision(-SWIPE_THRESHOLD_PX + 1, -1)).toBe('return')
    expect(swipeDecision(0, -1)).toBe('return')
  })

  it('ignores drags against the swipe direction for LTR rows', () => {
    expect(swipeDecision(SWIPE_THRESHOLD_PX, -1)).toBe('return')
  })

  it('mirrors the swipe direction for RTL rows', () => {
    expect(swipeDecision(-SWIPE_THRESHOLD_PX, 1)).toBe('return')
    expect(swipeDecision(SWIPE_THRESHOLD_PX, 1)).toBe('toggle')
  })
})
