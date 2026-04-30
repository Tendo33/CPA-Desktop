import type { ReactNode } from 'react'

interface SectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-accent">
          {title}
        </span>
        {action}
      </div>
      <div className="section-frame">{children}</div>
    </section>
  )
}
