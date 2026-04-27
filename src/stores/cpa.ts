import { create } from 'zustand'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCpaStatus, getCpaPort, type CpaStatus } from '@/lib/tauri'
import { IDLE } from '@/lib/cpaStatus'
import { DEFAULT_PORT } from '@/constants'

interface CpaStore {
  status: CpaStatus
  port: number
  initialized: boolean
  setStatus: (s: CpaStatus) => void
  initialize: () => Promise<UnlistenFn>
}

export const useCpaStore = create<CpaStore>((set) => ({
  status: IDLE,
  port: DEFAULT_PORT,
  initialized: false,
  setStatus: (status) => set({ status }),
  initialize: async () => {
    const [status, port] = await Promise.all([getCpaStatus(), getCpaPort()])
    set({ status, port, initialized: true })
    const unlisten = await listen<CpaStatus>('cpa:status', (e) => set({ status: e.payload }))
    return unlisten
  },
}))
