import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CpaWebView } from '@/components/CpaWebView'
import { evalInWebview } from '@/lib/tauri'

type Unlisten = () => void
type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const tauriMocks = vi.hoisted(() => {
  const win = {
    innerSize: vi.fn(async () => ({ width: 1200, height: 800 })),
    scaleFactor: vi.fn(async () => 1),
    onResized: vi.fn(),
    onFocusChanged: vi.fn(),
  }
  const webviews: MockWebview[] = []
  class MockWebview {
    static getByLabel = vi.fn(async () => null)
    close = vi.fn(async () => {})
    hide = vi.fn(async () => {})
    show = vi.fn(async () => {})
    setFocus = vi.fn(async () => {})
    setPosition = vi.fn(async () => {})
    setSize = vi.fn(async () => {})

    constructor() {
      webviews.push(this)
    }

    once(event: string, cb: () => void) {
      if (event === 'tauri://created') queueMicrotask(cb)
    }
  }
  return { win, getCurrentWindow: vi.fn(() => win), listen: vi.fn(), Webview: MockWebview, webviews }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: tauriMocks.getCurrentWindow,
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}))

vi.mock('@tauri-apps/api/webview', () => ({
  Webview: tauriMocks.Webview,
}))

vi.mock('@/lib/tauri', () => ({
  evalInWebview: vi.fn(),
}))

describe('CpaWebView window listener cleanup', () => {
  let resizeDeferred: Deferred<Unlisten>
  let focusDeferred: Deferred<Unlisten>

  beforeEach(() => {
    vi.clearAllMocks()
    tauriMocks.webviews.length = 0
    tauriMocks.getCurrentWindow.mockReturnValue(tauriMocks.win)
    tauriMocks.listen.mockResolvedValue(vi.fn())
    tauriMocks.Webview.getByLabel.mockResolvedValue(null)
    vi.mocked(evalInWebview).mockResolvedValue()
    resizeDeferred = deferred<Unlisten>()
    focusDeferred = deferred<Unlisten>()
    tauriMocks.win.onResized.mockReturnValue(resizeDeferred.promise)
    tauriMocks.win.onFocusChanged.mockReturnValue(focusDeferred.promise)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cleans up both listeners when focus resolves before resize', async () => {
    const resizeUnlisten = vi.fn()
    const focusUnlisten = vi.fn()
    const { unmount } = render(<CpaWebView url="http://127.0.0.1:8317" visible={false} />)

    await waitFor(() => expect(tauriMocks.win.onFocusChanged).toHaveBeenCalledTimes(1))

    await act(async () => {
      focusDeferred.resolve(focusUnlisten)
      await focusDeferred.promise
      resizeDeferred.resolve(resizeUnlisten)
      await resizeDeferred.promise
    })

    unmount()

    expect(focusUnlisten).toHaveBeenCalledTimes(1)
    expect(resizeUnlisten).toHaveBeenCalledTimes(1)
  })

  it('immediately cleans up listeners that resolve after unmount', async () => {
    const resizeUnlisten = vi.fn()
    const focusUnlisten = vi.fn()
    const { unmount } = render(<CpaWebView url="http://127.0.0.1:8317" visible={false} />)

    await waitFor(() => expect(tauriMocks.win.onFocusChanged).toHaveBeenCalledTimes(1))
    unmount()

    await act(async () => {
      resizeDeferred.resolve(resizeUnlisten)
      focusDeferred.resolve(focusUnlisten)
      await resizeDeferred.promise
      await focusDeferred.promise
    })

    expect(resizeUnlisten).toHaveBeenCalledTimes(1)
    expect(focusUnlisten).toHaveBeenCalledTimes(1)
  })

  it('skips native window listeners when the Tauri window is unavailable', () => {
    tauriMocks.getCurrentWindow.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'metadata')")
    })

    expect(() => render(<CpaWebView url="http://127.0.0.1:8317" visible={false} />)).not.toThrow()
    expect(tauriMocks.win.onResized).not.toHaveBeenCalled()
    expect(tauriMocks.win.onFocusChanged).not.toHaveBeenCalled()
  })

  it('reports auto-login status errors emitted by the child webview', async () => {
    const onAutoLoginError = vi.fn()
    let handler: ((event: { payload: { status: string; message?: string } }) => void) | null = null
    tauriMocks.listen.mockImplementation(async (_event: string, cb: typeof handler) => {
      handler = cb
      return vi.fn()
    })

    render(
      <CpaWebView
        url="http://127.0.0.1:8317"
        visible={false}
        onAutoLoginError={onAutoLoginError}
      />,
    )

    await waitFor(() =>
      expect(tauriMocks.listen).toHaveBeenCalledWith('cpa:auto-login-status', handler),
    )

    act(() => {
      handler?.({ payload: { status: 'error', message: 'storage protocol mismatch' } })
    })

    expect(onAutoLoginError).toHaveBeenCalledWith('storage protocol mismatch')
  })

  it('injects auto-login when credentials arrive after the webview is already visible', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<CpaWebView url="http://127.0.0.1:8317" visible />)

    await act(async () => {
      vi.advanceTimersByTime(150)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(tauriMocks.webviews).toHaveLength(1)
    expect(evalInWebview).not.toHaveBeenCalled()

    rerender(
      <CpaWebView
        url="http://127.0.0.1:8317"
        visible
        autoLogin={{ apiBase: 'http://127.0.0.1:8317', secretKey: 'secret-from-config' }}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(350)
      await Promise.resolve()
    })

    expect(evalInWebview).toHaveBeenCalledTimes(1)
    expect(evalInWebview).toHaveBeenCalledWith(
      'cpa-content',
      expect.stringContaining('secret-from-config'),
    )
  })
})
