import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCpaStore } from '@/stores/cpa'
import { DEFAULT_PORT } from '@/constants'
import { IDLE, RUNNING } from '@/lib/cpaStatus'

const tauriMocks = vi.hoisted(() => ({
  getCpaStatus: vi.fn(),
  getCpaPort: vi.fn(),
  checkCpaRunning: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@/lib/tauri', () => ({
  getCpaStatus: tauriMocks.getCpaStatus,
  getCpaPort: tauriMocks.getCpaPort,
  checkCpaRunning: tauriMocks.checkCpaRunning,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen,
}))

describe('useCpaStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCpaStore.setState({
      status: IDLE,
      port: DEFAULT_PORT,
      initialized: false,
    })
    tauriMocks.getCpaStatus.mockResolvedValue(IDLE)
    tauriMocks.getCpaPort.mockResolvedValue(DEFAULT_PORT)
    tauriMocks.checkCpaRunning.mockResolvedValue(false)
    tauriMocks.listen.mockResolvedValue(vi.fn())
  })

  it('treats an already reachable CPA service as running during initialization', async () => {
    tauriMocks.checkCpaRunning.mockResolvedValue(true)

    await useCpaStore.getState().initialize()

    expect(useCpaStore.getState().status).toEqual(RUNNING)
  })
})
