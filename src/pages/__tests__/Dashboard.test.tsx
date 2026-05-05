import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '@/pages/Dashboard'
import { useCpaStore } from '@/stores/cpa'
import { useSettingsStore } from '@/stores/settings'
import { RUNNING } from '@/lib/cpaStatus'

const tauriMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  probeManagementApi: vi.fn(),
  readConfigField: vi.fn(),
  saveSettings: vi.fn(),
  setCpaPort: vi.fn(),
  startCpa: vi.fn(),
}))

vi.mock('@/lib/tauri', () => ({
  getSettings: tauriMocks.getSettings,
  probeManagementApi: tauriMocks.probeManagementApi,
  readConfigField: tauriMocks.readConfigField,
  saveSettings: tauriMocks.saveSettings,
  setCpaPort: tauriMocks.setCpaPort,
  startCpa: tauriMocks.startCpa,
}))

vi.mock('@/components/CpaWebView', async () => {
  const React = await import('react')
  return {
    CpaWebView: React.forwardRef(
      (
        props: {
          url: string
          visible: boolean
          autoLogin: unknown
        },
        ref,
      ) => {
        React.useImperativeHandle(ref, () => ({ reload: vi.fn() }))
        return (
          <div
            data-testid="cpa-webview"
            data-url={props.url}
            data-visible={props.visible ? 'true' : 'false'}
            data-has-auto-login={props.autoLogin ? 'true' : 'false'}
          />
        )
      },
    ),
  }
})

vi.mock('@/components/MgmtUnavailableOverlay', () => ({
  MgmtUnavailableOverlay: ({ reason }: { reason: string }) => (
    <div data-testid="mgmt-overlay" data-reason={reason} />
  ),
}))

describe('Dashboard management webview safety', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useSettingsStore.setState({ lang: 'en', theme: 'dark' })
    useCpaStore.setState({ status: RUNNING, port: 8317, initialized: true })
    tauriMocks.readConfigField.mockResolvedValue('secret-from-config')
    tauriMocks.probeManagementApi.mockResolvedValue('down')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses loopback IP and does not inject the secret until management is verified', async () => {
    render(<Dashboard />)

    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(850)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('mgmt-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('mgmt-overlay')).toHaveAttribute('data-reason', 'down')

    const webview = screen.getByTestId('cpa-webview')
    expect(webview).toHaveAttribute('data-url', 'http://127.0.0.1:8317/management.html#/quota')
    expect(webview).toHaveAttribute('data-has-auto-login', 'false')
  })
})
