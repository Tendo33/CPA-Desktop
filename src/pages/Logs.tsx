import { useState } from 'react'
import { LogList } from '@/components/LogList'
import { useLogStore } from '@/stores/logs'
import { clearLogs } from '@/lib/tauri'
import { Trash2, ArrowDown } from 'lucide-react'

export function Logs() {
  const { lines, clear } = useLogStore()
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [levelFilter, setLevelFilter] = useState<'all' | 'stdout' | 'stderr'>('all')

  const filtered = lines.filter((l) => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (search && !l.text.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleClear = () => {
    clearLogs()
    clear()
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0 bg-zinc-900">
        <input
          placeholder="Filter logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-6 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 w-40"
        />
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}
          className="h-6 text-xs bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-200 outline-none focus:border-zinc-500"
        >
          <option value="all">All</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
        </select>

        <label className="flex items-center gap-1 text-[11px] text-zinc-500 cursor-pointer ml-1 select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-zinc-500 w-3 h-3"
          />
          <ArrowDown size={10} />
          Auto
        </label>

        <span className="ml-auto text-[11px] text-zinc-600 tabular-nums">
          {filtered.length} / {lines.length}
        </span>

        <button
          onClick={handleClear}
          title="Clear logs"
          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {lines.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          No logs yet — start CPA to see output
        </div>
      ) : (
        <LogList lines={filtered} autoScroll={autoScroll} />
      )}
    </div>
  )
}
