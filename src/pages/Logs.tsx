import { useEffect, useState, useMemo } from 'react'
import { LogList } from '@/components/LogList'
import { useLogStore } from '@/stores/logs'
import { useCpaStore } from '@/stores/cpa'
import { clearLogs } from '@/lib/tauri'
import { isRunning } from '@/lib/cpaStatus'
import { Trash2 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Input, Toggle, Tabs } from '@/components/ui'

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
  const { status } = useCpaStore()
  const cpaRunning = isRunning(status)
  const t = useT()
  const [search, setSearch] = useState<string>(() => localStorage.getItem(LS_SEARCH) ?? '')
  const [autoScroll, setAutoScroll] = useState<boolean>(
    () => localStorage.getItem(LS_AUTOSCROLL) !== '0',
  )
  const [levelFilter, setLevelFilter] = useState<Level>(loadLevel)

  useEffect(() => {
    localStorage.setItem(LS_LEVEL, levelFilter)
  }, [levelFilter])
  useEffect(() => {
    localStorage.setItem(LS_SEARCH, search)
  }, [search])
  useEffect(() => {
    localStorage.setItem(LS_AUTOSCROLL, autoScroll ? '1' : '0')
  }, [autoScroll])

  const LEVELS: { id: Level; label: string }[] = [
    { id: 'all', label: t.logs.all },
    { id: 'stdout', label: t.logs.out },
    { id: 'stderr', label: t.logs.err },
  ]

  const filtered = useMemo(
    () =>
      lines.filter((l) => {
        if (levelFilter !== 'all' && l.level !== levelFilter) return false
        if (search && !l.text.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [lines, levelFilter, search],
  )

  const handleClear = () => {
    clearLogs()
    clear()
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2.5 h-9 bg-surface border-b border-border-sub shrink-0">
        <Input
          placeholder={t.logs.filter}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-36"
        />

        <Tabs
          items={LEVELS}
          active={levelFilter}
          onChange={setLevelFilter}
          className="rounded-md"
          tabClassName={(active, id) =>
            active
              ? id === 'stderr'
                ? 'bg-hover text-err font-semibold'
                : 'bg-hover text-text-1 font-semibold'
              : 'bg-transparent text-text-3 hover:text-text-2'
          }
        />

        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <Toggle checked={autoScroll} onChange={setAutoScroll} ariaLabel={t.logs.autoScroll} />
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
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-raised border border-border flex items-center justify-center shadow-sm">
            <span className="text-xl text-text-3">≡</span>
          </div>
          <div className="flex flex-col gap-1.5 max-w-[280px]">
            <p className="text-[15px] font-semibold text-text-1">
              {!cpaRunning ? t.logs.notRunningTitle : t.logs.noOutputTitle}
            </p>
            <p className="text-[13px] text-text-3 leading-relaxed">
              {!cpaRunning ? t.logs.notRunningBody : t.logs.noOutputBody}
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-raised border border-border flex items-center justify-center shadow-sm">
            <span className="text-xl text-text-3">⌕</span>
          </div>
          <div className="flex flex-col gap-1.5 max-w-[280px]">
            <p className="text-[15px] font-semibold text-text-1">{t.logs.noMatchesTitle}</p>
            <p className="text-[13px] text-text-3 leading-relaxed">{t.logs.noMatchesBody}</p>
          </div>
          <button
            onClick={() => {
              setSearch('')
              setLevelFilter('all')
            }}
            className="mt-2 text-[12px] font-medium text-accent hover:text-text-1 transition-colors cursor-pointer bg-transparent border-none"
          >
            {t.logs.clearFilters}
          </button>
        </div>
      ) : (
        <LogList lines={filtered} autoScroll={autoScroll} />
      )}
    </div>
  )
}
