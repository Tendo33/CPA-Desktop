import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../Button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click</Button>)
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument()
  })
  it('applies danger variant class', () => {
    render(<Button variant="danger">x</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-err-bg')
  })
  it('applies sm size', () => {
    render(<Button size="sm">small</Button>)
    expect(screen.getByRole('button').className).toMatch(/h-9/)
  })
})
