import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { PRODUCT_CATEGORIES, type ProductCategory } from '../lib/product-category'
import { AppDrawer } from './drawer'

export function CategoryFilterDrawer({
  open,
  onOpenChange,
  selectedCategories,
  onChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
  selectedCategories: ReadonlySet<ProductCategory>
  onChange(categories: ReadonlySet<ProductCategory>): void
}) {
  const { t } = useTranslation()
  const allCategoriesSelected = selectedCategories.size === PRODUCT_CATEGORIES.length
  const orderedCategories = [
    ...selectedCategories,
    ...PRODUCT_CATEGORIES.filter((category) => !selectedCategories.has(category))
  ]

  function toggleCategory(category: ProductCategory) {
    const next = new Set(selectedCategories)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    onChange(next)
  }

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('categoryFilterTitle')}
      className="category-filter-drawer"
    >
      <div className="category-filter-options">
        <motion.button
          layout
          type="button"
          className="category-filter-option all-categories-option"
          aria-pressed={allCategoriesSelected}
          onClick={() => onChange(allCategoriesSelected ? new Set() : new Set(PRODUCT_CATEGORIES))}
        >
          {t('allCategories')}
        </motion.button>
        {orderedCategories.map((category) => (
          <motion.button
            layout
            key={category}
            type="button"
            className="category-filter-option"
            aria-pressed={selectedCategories.has(category)}
            onClick={() => toggleCategory(category)}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
          >
            {t(`category_${category}`)}
          </motion.button>
        ))}
      </div>
    </AppDrawer>
  )
}
