import { useEffect, useRef } from 'react'
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
    <div
      className="selectable"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '6px 0',
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className="font-log"
          style={{
            display: 'flex',
            gap: 0,
            fontSize: 11,
            lineHeight: 1.65,
            borderLeft: line.level === 'stderr'
              ? '2px solid var(--c-err)'
              : '2px solid transparent',
          }}
        >
          {/* Timestamp gutter */}
          <span
            style={{
              color: 'var(--c-text-3)',
              flexShrink: 0,
              width: 88,
              paddingLeft: 10,
              paddingRight: 8,
              userSelect: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {line.ts.substring(11, 23)}
          </span>

          {/* Message */}
          <span
            style={{
              color: line.level === 'stderr'
                ? 'oklch(72% 0.16 22)'
                : 'var(--c-text-2)',
              paddingRight: 12,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {line.text}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
