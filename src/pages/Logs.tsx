import { useState } from 'react'
import { LogList } from '@/components/LogList'
import { useLogStore } from '@/stores/logs'
import { clearLogs } from '@/lib/tauri'
import { Trash2 } from 'lucide-react'

type Level = 'all' | 'stdout' | 'stderr'

const LEVELS: { id: Level; label: string }[] = [
  { id: 'all',    label: 'All' },
  { id: 'stdout', label: 'Out' },
  { id: 'stderr', label: 'Err' },
]

export function Logs() {
  const { lines, clear } = useLogStore()
  const [search, setSearch]           = useState('')
  const [autoScroll, setAutoScroll]   = useState(true)
  const [levelFilter, setLevelFilter] = useState<Level>('all')

  const filtered = lines.filter((l) => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (search && !l.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleClear = () => { clearLogs(); clear() }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          height: 36,
          background: 'var(--c-surface)',
          borderBottom: '1px solid var(--c-border-sub)',
          flexShrink: 0,
        }}
      >
        {/* Search */}
        <input
          placeholder="Filter…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="selectable"
          style={{
            height: 22,
            background: 'var(--c-raised)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            padding: '0 8px',
            fontSize: 11,
            color: 'var(--c-text-1)',
            outline: 'none',
            width: 140,
            fontFamily: 'inherit',
            transition: 'border-color 130ms ease',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent-dim)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--c-border)')}
        />

        {/* Level pills */}
        <div style={{ display: 'flex', gap: 2, padding: '2px', background: 'var(--c-raised)', borderRadius: 5, border: '1px solid var(--c-border)' }}>
          {LEVELS.map(({ id, label }) => {
            const active = levelFilter === id
            return (
              <button
                key={id}
                onClick={() => setLevelFilter(id)}
                style={{
                  fontSize: 10,
                  fontWeight: active ? 600 : 400,
                  fontFamily: 'inherit',
                  padding: '1px 7px',
                  borderRadius: 3,
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: '0.02em',
                  transition: 'background 120ms ease, color 120ms ease',
                  background: active ? 'var(--c-hover)' : 'transparent',
                  color: active
                    ? (id === 'stderr' ? 'var(--c-err)' : 'var(--c-text-1)')
                    : 'var(--c-text-3)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Auto-scroll */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            cursor: 'pointer',
            fontSize: 11,
            color: autoScroll ? 'var(--c-text-2)' : 'var(--c-text-3)',
          }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ display: 'none' }}
          />
          <button
            className={`toggle ${autoScroll ? 'on' : ''}`}
            onClick={() => setAutoScroll((v) => !v)}
            aria-label="Auto-scroll"
          >
            <span className="toggle-thumb" />
          </button>
          <span style={{ userSelect: 'none' }}>Tail</span>
        </label>

        {/* Count */}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--c-text-3)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.01em',
          }}
        >
          {filtered.length !== lines.length
            ? `${filtered.length} / ${lines.length}`
            : `${lines.length} lines`}
        </span>

        {/* Clear */}
        <button
          onClick={handleClear}
          title="Clear logs"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: 'var(--c-text-3)',
            cursor: 'pointer',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--c-hover)'
            e.currentTarget.style.color = 'var(--c-err)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--c-text-3)'
          }}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Log content */}
      {lines.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <div style={{
            width: 32, height: 32,
            borderRadius: 8,
            border: '1px solid var(--c-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14, color: 'var(--c-text-3)' }}>≡</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
            No output yet — start CPA to see logs
          </p>
        </div>
      ) : (
        <LogList lines={filtered} autoScroll={autoScroll} />
      )}
    </div>
  )
}
