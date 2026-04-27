import { create } from 'zustand'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCpaStatus, getCpaPort, type CpaStatus } from '@/lib/tauri'

interface CpaStore {
  status: CpaStatus
  port: number
  initialized: boolean
  setStatus: (s: CpaStatus) => void
  initialize: () => Promise<UnlistenFn>
}

export const useCpaStore = create<CpaStore>((set) => ({
  status: 'Idle',
  port: 8317,
  initialized: false,
  setStatus: (status) => set({ status }),
  initialize: async () => {
    const [status, port] = await Promise.all([getCpaStatus(), getCpaPort()])
    set({ status, port, initialized: true })
    const unlisten = await listen<CpaStatus>('cpa:status', (e) =>
      set({ status: e.payload }),
    )
    return unlisten
  },
}))
