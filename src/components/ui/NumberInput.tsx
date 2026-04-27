import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onChange, min, max, ...rest }, ref) => (
    <input
      ref={ref}
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        'h-7 w-20 px-2 rounded-md border border-border bg-raised text-text-1 text-xs text-right tabular-nums',
        'focus:outline-none focus:border-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent transition-colors',
        className,
      )}
      {...rest}
    />
  ),
)
NumberInput.displayName = 'NumberInput'
