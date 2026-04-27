import { create } from 'zustand'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getLogHistory, type LogLine } from '@/lib/tauri'

const MAX_LINES = 2000

interface LogStore {
  lines: LogLine[]
  addLine: (line: LogLine) => void
  clear: () => void
  initialize: () => Promise<UnlistenFn>
}

export const useLogStore = create<LogStore>((set, get) => ({
  lines: [],
  addLine: (line) =>
    set((s) => ({
      lines:
        s.lines.length >= MAX_LINES
          ? [...s.lines.slice(-MAX_LINES + 1), line]
          : [...s.lines, line],
    })),
  clear: () => set({ lines: [] }),
  initialize: async () => {
    const history = await getLogHistory()
    set({ lines: history.slice(-MAX_LINES) })
    const unlisten = await listen<LogLine>('cpa:log', (e) =>
      get().addLine(e.payload),
    )
    return unlisten
  },
}))
