/** The ten built-in category names seeded for every household. */
export const SEED_CATEGORY_NAMES = [
  'fruit_vegetables',
  'dairy_eggs',
  'meat_fish',
  'bakery',
  'pantry',
  'frozen',
  'drinks',
  'snacks',
  'household',
  'other'
] as const

/**
 * Resolves a category's display label. Built-in names keep their localized
 * translations; custom names fall back to their stored name. i18next returns
 * the key itself when a translation is missing, which is how the fallback is
 * detected.
 */
export function categoryLabel(t: (key: string) => string, name: string): string {
  const key = `category_${name}`
  const localized = t(key)
  return localized === key ? name : localized
}
