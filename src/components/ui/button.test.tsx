import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('exposes the shared data-slot contract', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-slot', 'button')
  })

  it('carries the approved mobile-first action geometry classes', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(
      'min-h-12',
      'text-base',
      'font-bold',
      'rounded-md'
    )
  })

  it('keeps the lg action size on the same 48px geometry as the default', () => {
    render(<Button size="lg">Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('min-h-12')
  })
})
