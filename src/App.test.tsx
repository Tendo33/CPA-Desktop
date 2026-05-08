import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useSettingsStore } from '@/stores/settings'

const tauriMocks = vi.hoisted(() => ({
  applyAppUpdate: vi.fn(),
  checkAppUpdate: vi.fn(),
  detectInstallSources: vi.fn(),
  getSettings: vi.fn(),
  getSetupStatus: vi.fn(),
  setInstallSource: vi.fn(),
}))

vi.mock('@/lib/tauri', () => ({
  applyAppUpdate: tauriMocks.applyAppUpdate,
  checkAppUpdate: tauriMocks.checkAppUpdate,
  detectInstallSources: tauriMocks.detectInstallSources,
  getSettings: tauriMocks.getSettings,
  getSetupStatus: tauriMocks.getSetupStatus,
  setInstallSource: tauriMocks.setInstallSource,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}))

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(() => Promise.resolve()),
  unregister: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(false)),
  sendNotification: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar" />,
}))

vi.mock('@/components/StatusBar', () => ({
  StatusBar: () => <div data-testid="statusbar" />,
}))

vi.mock('@/components/ui', () => ({
  Toaster: () => null,
}))

vi.mock('@/pages/Dashboard', () => ({
  Dashboard: () => <div data-testid="dashboard" />,
}))

vi.mock('@/pages/Logs', () => ({
  Logs: () => <div data-testid="logs" />,
}))

vi.mock('@/pages/AuthFiles', () => ({
  AuthFilesPage: () => <div data-testid="auth-files" />,
}))

vi.mock('@/pages/Settings', () => ({
  SettingsPage: () => <div data-testid="settings" />,
}))

vi.mock('@/pages/About', () => ({
  AboutPage: () => <div data-testid="about" />,
}))

vi.mock('@/components/setup/SetupWizard', () => ({
  SetupWizard: () => <div data-testid="setup" />,
}))

vi.mock('@/stores/cpa', () => ({
  useCpaStore: () => ({ initialize: () => Promise.resolve(vi.fn()) }),
}))

vi.mock('@/stores/logs', () => ({
  useLogStore: () => ({ initialize: () => Promise.resolve(vi.fn()) }),
}))

describe('App app-update scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useSettingsStore.setState({ lang: 'en', theme: 'dark' })
    useAppSettingsStore.setState({ autoCheckAppUpdates: false })
    tauriMocks.getSetupStatus.mockResolvedValue({
      binaryPresent: true,
      configPresent: true,
      secretKeySet: true,
      apiKeysConfigured: true,
      cpaAlreadyRunning: false,
      installSourceKind: 'managed',
    })
    tauriMocks.getSettings.mockResolvedValue({ autoCheckAppUpdates: false })
    tauriMocks.checkAppUpdate.mockResolvedValue(null)
  })

  it('schedules and cancels automatic update checks when the setting changes in-session', async () => {
    render(<App />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauriMocks.getSettings).toHaveBeenCalled()

    act(() => {
      useAppSettingsStore.getState().setAutoCheckAppUpdates(true)
    })
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 60 * 1000)
      await Promise.resolve()
    })
    expect(tauriMocks.checkAppUpdate).toHaveBeenCalledTimes(1)

    act(() => {
      useAppSettingsStore.getState().setAutoCheckAppUpdates(false)
    })
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 60 * 1000)
      await Promise.resolve()
    })
    expect(tauriMocks.checkAppUpdate).toHaveBeenCalledTimes(1)
  })
})
