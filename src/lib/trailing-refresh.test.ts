import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrailingRefresh } from './trailing-refresh'

afterEach(() => vi.useRealTimers())

describe('TrailingRefresh', () => {
  it('coalesces a burst and guarantees one follow-up after an active refresh', async () => {
    vi.useFakeTimers()
    const resolvers: Array<() => void> = []
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const trailing = new TrailingRefresh(refresh, 100)

    trailing.runNow()
    expect(refresh).toHaveBeenCalledTimes(1)
    trailing.schedule()
    trailing.schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(1)

    resolvers[0]?.()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    resolvers[1]?.()
    trailing.dispose()
  })

  it('cancels an older React Query fetch and commits the post-event response', async () => {
    vi.useFakeTimers()
    const requests: Array<{
      signal: AbortSignal
      resolve(value: string): void
    }> = []
    const queryClient = new QueryClient()
    const queryKey = ['products']
    queryClient.setQueryData(queryKey, 'cached')
    const queryFn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          requests.push({ signal, resolve })
        })
    )
    const observer = new QueryObserver(queryClient, { queryKey, queryFn })
    const unsubscribe = observer.subscribe(() => undefined)
    expect(requests).toHaveLength(1)

    const trailing = new TrailingRefresh(
      () => queryClient.refetchQueries({ queryKey, type: 'active' }),
      100
    )
    trailing.schedule()
    await vi.advanceTimersByTimeAsync(100)

    expect(requests[0]?.signal.aborted).toBe(true)
    expect(requests).toHaveLength(2)
    requests[1]?.resolve('fresh')
    await vi.waitFor(() => expect(queryClient.getQueryData(queryKey)).toBe('fresh'))

    trailing.dispose()
    unsubscribe()
    queryClient.clear()
  })

  it('can run again after a refresh failure', async () => {
    vi.useFakeTimers()
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const trailing = new TrailingRefresh(refresh, 100)

    trailing.runNow()
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    trailing.schedule()
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))

    trailing.dispose()
  })
})
