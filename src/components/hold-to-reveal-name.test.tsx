import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldToRevealName } from './hold-to-reveal-name'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function renderTruncatedName() {
  const view = render(<HoldToRevealName name="A deliberately very long product name" />)
  const name = view.container.querySelector('.hold-name')!
  Object.defineProperties(name, {
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 300 }
  })
  return name
}

describe('HoldToRevealName', () => {
  it('reveals a name after holding and starts an animated exit on finger lift', () => {
    const name = renderTruncatedName()
    fireEvent.pointerDown(name, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    act(() => vi.advanceTimersByTime(360))

    expect(screen.getByRole('tooltip')).toHaveTextContent('A deliberately very long product name')
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 20, clientY: 20 })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('cancels the long press when the finger moves like a swipe', () => {
    const name = renderTruncatedName()
    fireEvent.pointerDown(name, {
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 42, clientY: 20 })
    act(() => vi.advanceTimersByTime(500))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('does not trigger the parent click after a completed long press', () => {
    const onClick = vi.fn()
    const { container } = render(
      <button onClick={onClick}>
        <HoldToRevealName name="A deliberately very long product name" />
      </button>
    )
    const name = container.querySelector('.hold-name')!
    Object.defineProperties(name, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 }
    })
    fireEvent.pointerDown(name, {
      pointerId: 4,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    act(() => vi.advanceTimersByTime(360))
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 20, clientY: 20 })
    fireEvent.click(name)

    expect(onClick).not.toHaveBeenCalled()
  })

  it('reveals a name even when the full name already fits', () => {
    const { container } = render(<HoldToRevealName name="Milk" />)
    const name = container.querySelector('.hold-name')!
    Object.defineProperties(name, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 100 }
    })
    fireEvent.pointerDown(name, {
      pointerId: 3,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByRole('tooltip')).toHaveTextContent('Milk')
  })

  it('shows notes under the product name', () => {
    const { container } = render(<HoldToRevealName name="Milk" notes="Only if it is on sale" />)
    const name = container.querySelector('.hold-name')!
    fireEvent.pointerDown(name, {
      pointerId: 5,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    act(() => vi.advanceTimersByTime(360))

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.querySelector('strong')).toHaveTextContent('Milk')
    expect(tooltip.querySelector('span')).toHaveTextContent('Only if it is on sale')
  })

  it('stops a pending hold when the pointer is cancelled before the timer fires', () => {
    const name = renderTruncatedName()
    fireEvent.pointerDown(name, {
      pointerId: 6,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    fireEvent.pointerCancel(window, { pointerId: 6, clientX: 20, clientY: 20 })
    // Even well past the hold delay, no tooltip appears.
    act(() => vi.advanceTimersByTime(500))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('cancels the long press on a diagonal swipe away from the start point', () => {
    const name = renderTruncatedName()
    fireEvent.pointerDown(name, {
      pointerId: 7,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 28, clientY: 28 })
    act(() => vi.advanceTimersByTime(500))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('cleans up pointer listeners and the timer on unmount', () => {
    const view = render(<HoldToRevealName name="Milk" />)
    const name = view.container.querySelector('.hold-name')!
    fireEvent.pointerDown(name, {
      pointerId: 8,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20
    })

    view.unmount()
    act(() => vi.advanceTimersByTime(500))
    // No timer fires and no listener error is thrown after unmount.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
