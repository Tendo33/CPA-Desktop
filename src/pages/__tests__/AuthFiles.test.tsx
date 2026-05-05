import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthFilesPage } from '@/pages/AuthFiles'
import { useCpaStore } from '@/stores/cpa'
import { useSettingsStore } from '@/stores/settings'
import { RUNNING } from '@/lib/cpaStatus'

const tauriMocks = vi.hoisted(() => ({
  createAuthSession: vi.fn(),
  exportAuthFiles: vi.fn(),
  listAuthFiles: vi.fn(),
  readConfigField: vi.fn(),
}))

vi.mock('@/lib/tauri', () => ({
  createAuthSession: tauriMocks.createAuthSession,
  exportAuthFiles: tauriMocks.exportAuthFiles,
  listAuthFiles: tauriMocks.listAuthFiles,
  readConfigField: tauriMocks.readConfigField,
}))

describe('AuthFilesPage secret handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useSettingsStore.setState({ lang: 'en', theme: 'dark' })
    useCpaStore.setState({ status: RUNNING, port: 8317, initialized: true })
    tauriMocks.readConfigField.mockResolvedValue('config-secret')
  })

  it('auto-fills the management password without persisting it to localStorage', async () => {
    render(<AuthFilesPage />)

    const label = screen.getByText('Management password / Bearer').closest('label')
    const input = label?.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()
    await waitFor(() => expect(input).toHaveValue('config-secret'))

    expect(localStorage.getItem('cpa.authFiles.password')).toBeNull()
  })
})
