import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { categoryLabel } from '../lib/product-category'
import type { Category } from '../lib/types'
import { AppDrawer } from './drawer'

export function CategoryFilterDrawer({
  open,
  onOpenChange,
  categories,
  selectedCategories,
  onChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
  categories: Category[]
  selectedCategories: ReadonlySet<string>
  onChange(categories: ReadonlySet<string>): void
}) {
  const { t } = useTranslation()
  const allCategoriesSelected = selectedCategories.size === categories.length
  const orderedCategories = [
    ...categories.filter((category) => selectedCategories.has(category.id)),
    ...categories.filter((category) => !selectedCategories.has(category.id))
  ]

  function toggleCategory(categoryId: string) {
    const next = new Set(selectedCategories)
    if (next.has(categoryId)) next.delete(categoryId)
    else next.add(categoryId)
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
          onClick={() =>
            onChange(allCategoriesSelected ? new Set() : new Set(categories.map((c) => c.id)))
          }
        >
          {t('allCategories')}
        </motion.button>
        {orderedCategories.map((category) => (
          <motion.button
            layout
            key={category.id}
            type="button"
            className="category-filter-option"
            aria-pressed={selectedCategories.has(category.id)}
            onClick={() => toggleCategory(category.id)}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
          >
            {categoryLabel(t, category.name)}
          </motion.button>
        ))}
      </div>
    </AppDrawer>
  )
}
