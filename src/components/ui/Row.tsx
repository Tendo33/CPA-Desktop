import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface RowProps {
  label: string
  hint?: string
  children: ReactNode
  first?: boolean
}

export function Row({ label, hint, children, first }: RowProps) {
  return (
    <div
      className={cn(
        'px-3.5 py-3 bg-surface flex items-center justify-between gap-4',
        !first && 'border-t border-border-sub',
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-text-1">{label}</span>
        {hint && <span className="text-[11px] text-text-3">{hint}</span>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}
