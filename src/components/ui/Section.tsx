import type { ReactNode } from 'react'

interface SectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
}

export function Section({ title, action, children }: SectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-accent">
          {title}
        </span>
        {action}
      </div>
      <div className="rounded-lg border border-border-sub overflow-hidden">{children}</div>
    </section>
  )
}
