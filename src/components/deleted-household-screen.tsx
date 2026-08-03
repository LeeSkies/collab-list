import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import type { DeletedHousehold } from '../lib/types'
import { Button } from './ui/button'

export function DeletedHouseholdScreen({ household }: { household: DeletedHousehold }) {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const [error, setError] = useState('')
  const recover = useMutation({
    mutationFn: api.household.recover,
    onSuccess: async () => {
      setError('')
      client.removeQueries({ queryKey: ['household-members', household.household_id], exact: true })
      client.removeQueries({
        queryKey: ['household-requests', household.household_id],
        exact: true
      })
      client.removeQueries({
        queryKey: ['household-subscription', household.household_id],
        exact: true
      })
      client.removeQueries({
        queryKey: ['household-entitlement', household.household_id],
        exact: true
      })
      const productsQueryKey = ['products', household.household_id] as const
      await client.invalidateQueries({ queryKey: productsQueryKey, exact: true })
      await client.refetchQueries({ queryKey: productsQueryKey, exact: true, type: 'all' })
      await auth.refreshProfile()
      await client.invalidateQueries({ queryKey: ['deleted-household', auth.user?.id] })
    },
    onError: () => setError(t('requestFailed'))
  })
  return (
    <main className="loading-page deleted-household-screen">
      <h1>{t('deletedHouseholdTitle')}</h1>
      <p>{t('deletedHouseholdBody')}</p>
      <p>
        {t('deletedHouseholdPurgeDate', {
          date: new Date(household.purge_at).toLocaleDateString()
        })}
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <Button type="button" onClick={() => recover.mutate()} disabled={recover.isPending}>
        {recover.isPending ? t('recoveringHousehold') : t('recoverHousehold')}
      </Button>
    </main>
  )
}
