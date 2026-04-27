import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const pill = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-raised text-text-2',
        accent: 'border-accent-dim bg-accent-bg text-accent',
        run: 'border-run/40 bg-raised text-run',
        err: 'border-err/40 bg-err-bg text-err',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pill>

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pill({ tone }), className)} {...props} />
}
