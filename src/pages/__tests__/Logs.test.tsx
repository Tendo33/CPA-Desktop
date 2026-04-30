import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Logs } from '@/pages/Logs'
import { useCpaStore } from '@/stores/cpa'
import { useLogStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_PORT } from '@/constants'
import { IDLE } from '@/lib/cpaStatus'

vi.mock('@/lib/tauri', () => ({
  clearLogs: vi.fn(),
}))

describe('Logs i18n', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ lang: 'zh', theme: 'dark' })
    useCpaStore.setState({ status: IDLE, port: DEFAULT_PORT, initialized: true })
    useLogStore.setState({ lines: [] })
  })

  it('renders the empty stopped state in the active language', () => {
    render(<Logs />)

    expect(screen.getByText('CPA 未在运行')).toBeInTheDocument()
    expect(screen.getByText('从首页启动 CPA 后，这里会显示实时日志。')).toBeInTheDocument()
  })
})
