import { describe, expect, it } from 'vitest'
import { formatChargeMinorUnits } from './money'

describe('formatChargeMinorUnits', () => {
  it('renders an exact two-decimal amount from minor units', () => {
    expect(formatChargeMinorUnits(990, 'USD', 'en-US')).toBe('$9.90')
    expect(formatChargeMinorUnits(1200, 'EUR', 'en-US')).toBe('€12.00')
  })

  it('respects currencies with no fractional units', () => {
    expect(formatChargeMinorUnits(100, 'JPY', 'en-US')).toContain('100')
  })

  it('keeps grouping for larger amounts', () => {
    expect(formatChargeMinorUnits(123456, 'USD', 'en-US')).toBe('$1,234.56')
  })

  it('rejects values that cannot cross the API as exact JavaScript integers', () => {
    expect(() => formatChargeMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'USD', 'en-US')).toThrow(
      'minor unit amount must be a non-negative safe integer'
    )
    expect(() => formatChargeMinorUnits(-1, 'USD', 'en-US')).toThrow(
      'minor unit amount must be a non-negative safe integer'
    )
  })
})
