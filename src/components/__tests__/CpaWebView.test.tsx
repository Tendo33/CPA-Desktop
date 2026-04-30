import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CpaWebView } from '@/components/CpaWebView'

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
  return { win, getCurrentWindow: vi.fn(() => win) }
})

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
  Webview: class Webview {
    static getByLabel = vi.fn(async () => null)
  },
}))

vi.mock('@/lib/tauri', () => ({
  evalInWebview: vi.fn(),
}))

describe('CpaWebView window listener cleanup', () => {
  let resizeDeferred: Deferred<Unlisten>
  let focusDeferred: Deferred<Unlisten>

  beforeEach(() => {
    vi.clearAllMocks()
    tauriMocks.getCurrentWindow.mockReturnValue(tauriMocks.win)
    resizeDeferred = deferred<Unlisten>()
    focusDeferred = deferred<Unlisten>()
    tauriMocks.win.onResized.mockReturnValue(resizeDeferred.promise)
    tauriMocks.win.onFocusChanged.mockReturnValue(focusDeferred.promise)
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
})
