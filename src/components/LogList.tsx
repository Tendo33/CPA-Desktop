import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { LogLine } from '@/lib/tauri'

interface Props {
  lines: LogLine[]
  autoScroll: boolean
}

export function LogList({ lines, autoScroll }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [lines.length, autoScroll])

  return (
    <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-[1.6] p-1.5 select-text">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex gap-2 hover:bg-white/5 px-1 py-0 rounded-sm',
            line.level === 'stderr' ? 'text-red-400' : 'text-zinc-300',
          )}
        >
          <span className="text-zinc-600 shrink-0 tabular-nums">
            {line.ts.substring(11, 23)}
          </span>
          <span className="break-all whitespace-pre-wrap">{line.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
