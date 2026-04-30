import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthSession, exportAuthFiles, listAuthFiles } from '@/lib/tauri'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('auth files IPC contract', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('exchanges admin password for a backend session id', async () => {
    invoke.mockResolvedValueOnce('session-1')

    await expect(createAuthSession('secret')).resolves.toBe('session-1')

    expect(invoke).toHaveBeenCalledWith('create_auth_session', { adminPassword: 'secret' })
  })

  it('lists auth files with session id instead of admin password', async () => {
    invoke.mockResolvedValueOnce([])

    await listAuthFiles('session-1')

    expect(invoke).toHaveBeenCalledWith('list_auth_files', { sessionId: 'session-1' })
    expect(invoke.mock.calls[0][1]).not.toHaveProperty('adminPassword')
  })

  it('exports auth files with session id instead of admin password', async () => {
    invoke.mockResolvedValueOnce({ saved: false })

    await exportAuthFiles({
      sessionId: 'session-1',
      names: ['one.json'],
      exportCpa: true,
      exportSub2api: false,
    })

    expect(invoke.mock.calls[0][0]).toBe('export_auth_files')
    expect(invoke.mock.calls[0][1].args).toMatchObject({ sessionId: 'session-1' })
    expect(invoke.mock.calls[0][1].args).not.toHaveProperty('adminPassword')
  })
})
