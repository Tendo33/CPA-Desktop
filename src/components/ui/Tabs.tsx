import { KeyboardEvent, useRef } from 'react'
import { cn } from '@/lib/utils'

interface TabItem<T extends string> {
  id: T
  label: string
}

interface TabsProps<T extends string> {
  items: TabItem<T>[]
  active: T
  onChange: (id: T) => void
  className?: string
  tabClassName?: (active: boolean, id: T) => string
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className,
  tabClassName,
}: TabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    if (!containerRef.current) return
    const buttons = Array.from(
      containerRef.current.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    )
    const idx = buttons.findIndex((b) => b === document.activeElement)
    if (idx === -1) return
    const next =
      e.key === 'ArrowRight'
        ? (idx + 1) % buttons.length
        : (idx - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      ref={containerRef}
      role="tablist"
      className={cn('flex gap-1 p-1 bg-raised rounded-md border border-border', className)}
      onKeyDown={handleKeyDown}
    >
      {items.map(({ id, label }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              'min-h-8 text-xs px-2.5 py-1 rounded border-0 cursor-pointer tracking-wide transition-colors',
              tabClassName
                ? tabClassName(isActive, id)
                : isActive
                  ? 'bg-hover text-text-1 font-semibold'
                  : 'bg-transparent text-text-3 hover:text-text-2',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
