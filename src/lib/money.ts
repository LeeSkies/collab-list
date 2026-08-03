// Exact provider-supplied add-on charge rendering. The amount is stored in
// minor units and converted with the currency's own fraction digits so the
// display never invents or rounds a price.
export function formatChargeMinorUnits(
  minorUnits: number,
  currency: string,
  locale: string
): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError('minor unit amount must be a non-negative safe integer')
  }
  const sample = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1)
  const fractionDigits = sample.find((part) => part.type === 'fraction')?.value.length ?? 0
  const divisor = 10 ** fractionDigits
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(minorUnits / divisor)
}
