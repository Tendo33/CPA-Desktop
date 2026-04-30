import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface RowProps {
  label: string
  hint?: string
  children: ReactNode
  first?: boolean
  className?: string
  controlClassName?: string
}

export function Row({ label, hint, children, first, className, controlClassName }: RowProps) {
  return (
    <div className={cn('settings-row', !first && 'border-t border-border-sub', className)}>
      <div className="settings-row-copy">
        <span className="text-[13px] font-medium text-text-1">{label}</span>
        {hint && (
          <span className="text-[12px] leading-relaxed text-text-3 break-words">{hint}</span>
        )}
      </div>
      <div className={cn('settings-row-control', controlClassName)}>{children}</div>
    </div>
  )
}
