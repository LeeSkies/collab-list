export const PRODUCT_CATEGORIES = [
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

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
