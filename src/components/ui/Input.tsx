import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 min-w-0 px-3 rounded-md border border-border bg-raised text-text-1 text-[13px]',
      'focus:outline-none focus:border-accent-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 transition-colors',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
