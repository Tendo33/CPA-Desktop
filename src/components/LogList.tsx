import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LogLine } from '@/lib/tauri'

interface Props {
  lines: LogLine[]
  autoScroll: boolean
}

const ROW_HEIGHT = 18

export function LogList({ lines, autoScroll }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  useEffect(() => {
    if (autoScroll && lines.length > 0) {
      rowVirtualizer.scrollToIndex(lines.length - 1, { align: 'end' })
    }
  }, [lines.length, autoScroll, rowVirtualizer])

  return (
    <div
      ref={parentRef}
      className="selectable"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '6px 0',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const line = lines[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              className="font-log"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                gap: 0,
                fontSize: 11,
                lineHeight: 1.65,
                borderLeft: line.level === 'stderr'
                  ? '2px solid var(--c-err)'
                  : '2px solid transparent',
              }}
            >
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
          )
        })}
      </div>
    </div>
  )
}
