import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@/pages/Settings'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useCpaStore } from '@/stores/cpa'
import { useSettingsStore } from '@/stores/settings'
import { RUNNING } from '@/lib/cpaStatus'

const tauriMocks = vi.hoisted(() => ({
  applyAppUpdate: vi.fn(),
  checkAppUpdate: vi.fn(),
  getAutolaunchEnabled: vi.fn(),
  getPortFromYaml: vi.fn(),
  getSettings: vi.fn(),
  openDataDir: vi.fn(),
  readConfigYaml: vi.fn(),
  saveSettings: vi.fn(),
  setAutolaunchEnabled: vi.fn(),
  setCpaPort: vi.fn(),
  startCpa: vi.fn(),
  stopCpa: vi.fn(),
  writeConfigYaml: vi.fn(),
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="config yaml editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/components/InstallSourceCard', () => ({
  InstallSourceCard: () => <div data-testid="install-source-card" />,
}))

vi.mock('@/components/ConfigForm', () => ({
  ConfigForm: () => <div data-testid="config-form" />,
}))

vi.mock('@/lib/tauri', () => ({
  applyAppUpdate: tauriMocks.applyAppUpdate,
  checkAppUpdate: tauriMocks.checkAppUpdate,
  getAutolaunchEnabled: tauriMocks.getAutolaunchEnabled,
  getPortFromYaml: tauriMocks.getPortFromYaml,
  getSettings: tauriMocks.getSettings,
  openDataDir: tauriMocks.openDataDir,
  readConfigYaml: tauriMocks.readConfigYaml,
  saveSettings: tauriMocks.saveSettings,
  setAutolaunchEnabled: tauriMocks.setAutolaunchEnabled,
  setCpaPort: tauriMocks.setCpaPort,
  startCpa: tauriMocks.startCpa,
  stopCpa: tauriMocks.stopCpa,
  writeConfigYaml: tauriMocks.writeConfigYaml,
}))

const baseSettings = {
  port: 8317,
  autoStart: false,
  cpaVersion: null,
  autoCheckAppUpdates: false,
  mirrors: [],
  startTimeoutSecs: 60,
  autoRestart: true,
  healthPath: '/health',
}

describe('SettingsPage critical flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ lang: 'en', theme: 'dark' })
    useAppSettingsStore.setState({ autoCheckAppUpdates: false })
    useCpaStore.setState({ status: RUNNING, port: 8317, initialized: true })
    tauriMocks.getSettings.mockResolvedValue({ ...baseSettings })
    tauriMocks.readConfigYaml.mockResolvedValue('port: 8317\n')
    tauriMocks.getAutolaunchEnabled.mockResolvedValue(false)
    tauriMocks.getPortFromYaml.mockResolvedValue(8317)
    tauriMocks.saveSettings.mockResolvedValue(undefined)
    tauriMocks.setCpaPort.mockResolvedValue(undefined)
    tauriMocks.stopCpa.mockResolvedValue(undefined)
    tauriMocks.startCpa.mockResolvedValue(undefined)
    tauriMocks.writeConfigYaml.mockResolvedValue(undefined)
  })

  it('shows YAML save errors and does not refresh the port after a rejected save', async () => {
    tauriMocks.writeConfigYaml.mockRejectedValueOnce('port not found in config.yaml')

    render(<SettingsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: 'YAML' }))
    fireEvent.change(await screen.findByLabelText('config yaml editor'), {
      target: { value: 'debug: true\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Apply' }))

    expect(await screen.findByText('port not found in config.yaml')).toBeInTheDocument()
    expect(tauriMocks.getPortFromYaml).toHaveBeenCalledTimes(1)
  })

  it('keeps restart banner visible and shows the failure when restart fails', async () => {
    tauriMocks.startCpa.mockRejectedValueOnce(new Error('port_in_use:8317'))

    render(<SettingsPage />)

    act(() => {
      window.dispatchEvent(new CustomEvent('cpa-config-dirty', { detail: { needsRestart: true } }))
    })
    expect(await screen.findByText(/Configuration changed/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))

    expect(await screen.findByText('port_in_use:8317')).toBeInTheDocument()
    expect(screen.getByText(/Configuration changed/)).toBeInTheDocument()
  })

  it('hides restart banner after a successful awaited restart', async () => {
    render(<SettingsPage />)

    act(() => {
      window.dispatchEvent(new CustomEvent('cpa-config-dirty', { detail: { needsRestart: true } }))
    })
    expect(await screen.findByText(/Configuration changed/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))

    await waitFor(() => expect(tauriMocks.stopCpa).toHaveBeenCalled())
    await waitFor(() => expect(tauriMocks.startCpa).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Configuration changed/)).not.toBeInTheDocument())
  })

  it('keeps a locally edited port visible while the live port event is pending', async () => {
    render(<SettingsPage />)

    const portInput = await screen.findByRole('spinbutton', { name: 'CPA Port' })
    fireEvent.change(portInput, { target: { value: '8320' } })

    expect(portInput).toHaveValue(8320)
    expect(tauriMocks.setCpaPort).toHaveBeenCalledWith(8320)
  })

  it('syncs the displayed port when a live CPA port event arrives', async () => {
    render(<SettingsPage />)

    const portInput = await screen.findByRole('spinbutton', { name: 'CPA Port' })

    act(() => {
      useCpaStore.setState({ port: 8420, initialized: true })
    })

    await waitFor(() => expect(portInput).toHaveValue(8420))
  })

  it('updates the in-session app update scheduler setting after saving the toggle', async () => {
    render(<SettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Auto-check on launch' }))

    await waitFor(() => expect(tauriMocks.saveSettings).toHaveBeenCalled())
    expect(useAppSettingsStore.getState().autoCheckAppUpdates).toBe(true)
  })
})
