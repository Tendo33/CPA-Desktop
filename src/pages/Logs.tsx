import { useEffect, useState } from 'react'
import { LogList } from '@/components/LogList'
import { useLogStore } from '@/stores/logs'
import { clearLogs } from '@/lib/tauri'
import { Trash2 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Input, Toggle } from '@/components/ui'
import { cn } from '@/lib/utils'

type Level = 'all' | 'stdout' | 'stderr'

const LS_LEVEL = 'cpa.logs.level'
const LS_SEARCH = 'cpa.logs.search'
const LS_AUTOSCROLL = 'cpa.logs.autoscroll'

function loadLevel(): Level {
  const v = localStorage.getItem(LS_LEVEL)
  return v === 'stdout' || v === 'stderr' || v === 'all' ? v : 'all'
}

export function Logs() {
  const { lines, clear } = useLogStore()
  const t = useT()
  const [search, setSearch] = useState<string>(() => localStorage.getItem(LS_SEARCH) ?? '')
  const [autoScroll, setAutoScroll] = useState<boolean>(() => localStorage.getItem(LS_AUTOSCROLL) !== '0')
  const [levelFilter, setLevelFilter] = useState<Level>(loadLevel)

  useEffect(() => { localStorage.setItem(LS_LEVEL, levelFilter) }, [levelFilter])
  useEffect(() => { localStorage.setItem(LS_SEARCH, search) }, [search])
  useEffect(() => { localStorage.setItem(LS_AUTOSCROLL, autoScroll ? '1' : '0') }, [autoScroll])

  const LEVELS: { id: Level; label: string }[] = [
    { id: 'all',    label: t.logs.all },
    { id: 'stdout', label: t.logs.out },
    { id: 'stderr', label: t.logs.err },
  ]

  const filtered = lines.filter((l) => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (search && !l.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleClear = () => { clearLogs(); clear() }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2.5 h-9 bg-surface border-b border-border-sub flex-shrink-0">
        <Input
          placeholder={t.logs.filter}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-36"
        />

        <div className="flex gap-0.5 p-0.5 bg-raised rounded-md border border-border">
          {LEVELS.map(({ id, label }) => {
            const active = levelFilter === id
            return (
              <button
                key={id}
                onClick={() => setLevelFilter(id)}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border-0 cursor-pointer tracking-wide transition-colors',
                  active
                    ? id === 'stderr'
                      ? 'bg-hover text-err font-semibold'
                      : 'bg-hover text-text-1 font-semibold'
                    : 'bg-transparent text-text-3 hover:text-text-2',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <Toggle checked={autoScroll} onChange={setAutoScroll} ariaLabel="Auto-scroll" />
          <span
            className="select-none"
            style={{ color: autoScroll ? 'var(--c-text-2)' : 'var(--c-text-3)' }}
          >
            {t.logs.tail}
          </span>
        </label>

        <span className="ml-auto text-[10px] text-text-3 tabular-nums">
          {filtered.length !== lines.length
            ? t.logs.filteredLines(filtered.length, lines.length)
            : t.logs.lines(lines.length)}
        </span>

        <button
          onClick={handleClear}
          title={t.logs.clearLogs}
          className="flex items-center justify-center w-6 h-6 rounded border-0 bg-transparent text-text-3 cursor-pointer transition-colors hover:bg-hover hover:text-err"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Log content */}
      {lines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-lg border border-border flex items-center justify-center">
            <span className="text-sm text-text-3">≡</span>
          </div>
          <p className="text-xs text-text-3">{t.logs.noOutput}</p>
        </div>
      ) : (
        <LogList lines={filtered} autoScroll={autoScroll} />
      )}
    </div>
  )
}
