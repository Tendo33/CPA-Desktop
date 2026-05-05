import { create } from 'zustand'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { checkCpaRunning, getCpaStatus, getCpaPort, type CpaStatus } from '@/lib/tauri'
import { IDLE, RUNNING } from '@/lib/cpaStatus'
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
    const [status, port, reachable] = await Promise.all([
      getCpaStatus(),
      getCpaPort(),
      checkCpaRunning().catch(() => false),
    ])
    set({ status: reachable ? RUNNING : status, port, initialized: true })
    const unlistenStatus = await listen<CpaStatus>('cpa:status', (e) => set({ status: e.payload }))
    const unlistenPort = await listen<number>('cpa:port', (e) => set({ port: e.payload }))
    return () => {
      unlistenStatus()
      unlistenPort()
    }
  },
}))
