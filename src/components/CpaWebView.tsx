import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
import { buildMgmtAutoLoginScript } from '@/lib/mgmtAutoLogin'
import { evalInWebview } from '@/lib/tauri'

export interface CpaWebViewHandle {
  reload: () => void
}

interface Props {
  url: string
  visible: boolean
  /**
   * When provided, the management panel is auto-logged-in by injecting
   * the equivalent of "remember me" persisted state into localStorage.
   * Pass `null` (or omit) to render the panel without auto-login.
   */
  autoLogin?: { apiBase: string; secretKey: string } | null
  onAutoLoginError?: (message: string) => void
}

const LABEL = 'cpa-content'
const SIDEBAR_W = 56
const STATUS_H = 28
type NativeWindow = ReturnType<typeof getCurrentWindow>
type AutoLoginStatusPayload = {
  status?: 'pending' | 'ok' | 'error'
  message?: string
}

function getNativeWindow(): NativeWindow | null {
  try {
    return getCurrentWindow()
  } catch {
    return null
  }
}

async function getLogicalSize(win: NativeWindow) {
  const size = await win.innerSize()
  const scale = await win.scaleFactor()
  return {
    width: Math.max(200, size.width / scale - SIDEBAR_W),
    height: Math.max(100, size.height / scale - STATUS_H),
  }
}

async function closeExisting() {
  try {
    const existing = await Webview.getByLabel(LABEL)
    if (existing) await existing.close()
  } catch {
    // fine — didn't exist
  }
}

async function spawnWebview(url: string): Promise<Webview | null> {
  await closeExisting()
  const win = getNativeWindow()
  if (!win) return null
  const { width, height } = await getLogicalSize(win)

  return new Promise<Webview>((resolve, reject) => {
    const wv = new Webview(win, LABEL, {
      url,
      x: SIDEBAR_W,
      y: 0,
      width,
      height,
      focus: true,
    })
    wv.once('tauri://created', () => resolve(wv))
    wv.once('tauri://error', (e) =>
      reject(new Error(String((e as { payload?: unknown })?.payload ?? e))),
    )
  })
}

export const CpaWebView = forwardRef<CpaWebViewHandle, Props>(
  ({ url, visible, autoLogin, onAutoLoginError }, ref) => {
    const wvRef = useRef<Webview | null>(null)
    const tokenRef = useRef(0)
    const injectedAutoLoginKeyRef = useRef<string | null>(null)
    const visibleRef = useRef(visible)
    visibleRef.current = visible
    const autoLoginRef = useRef(autoLogin)
    autoLoginRef.current = autoLogin
    const invalidateSpawnToken = useCallback(() => {
      tokenRef.current += 1
    }, [])

    const injectAutoLogin = useCallback(
      (token: number, al: { apiBase: string; secretKey: string } | null | undefined) => {
        if (!al?.secretKey) return
        const key = `${al.apiBase}\n${al.secretKey}`
        if (injectedAutoLoginKeyRef.current === key) return
        injectedAutoLoginKeyRef.current = key
        const script = buildMgmtAutoLoginScript(al)
        setTimeout(() => {
          if (tokenRef.current !== token) return
          evalInWebview(LABEL, script).catch((e) => {
            injectedAutoLoginKeyRef.current = null
            console.warn('[CpaWebView] auto-login eval failed', e)
            onAutoLoginError?.(e instanceof Error ? e.message : String(e))
          })
        }, 350)
      },
      [onAutoLoginError],
    )

    const spawn = useCallback(
      (u: string) => {
        const token = ++tokenRef.current
        injectedAutoLoginKeyRef.current = null
        spawnWebview(u)
          .then((wv) => {
            if (!wv) return
            if (tokenRef.current !== token) {
              wv.close()
              return
            }
            wvRef.current = wv
            if (visibleRef.current) {
              wv.show()
              wv.setFocus().catch(() => {})
            } else {
              wv.hide()
            }
            // Inject auto-login a beat after the page boots so the script
            // runs against the management origin's localStorage. The script
            // is idempotent and self-reloads only on first run.
            injectAutoLogin(token, autoLoginRef.current)
          })
          .catch(console.error)
      },
      [injectAutoLogin],
    )

    useImperativeHandle(ref, () => ({ reload: () => spawn(url) }), [spawn, url])

    useEffect(() => {
      if (!visible || !wvRef.current) return
      injectAutoLogin(tokenRef.current, autoLogin)
    }, [autoLogin, injectAutoLogin, visible])

    useEffect(() => {
      if (!onAutoLoginError) return
      let disposed = false
      let unlisten: (() => void) | null = null

      void listen<AutoLoginStatusPayload>('cpa:auto-login-status', ({ payload }) => {
        if (payload?.status === 'error') {
          onAutoLoginError(payload.message || 'Auto-login failed')
        }
      })
        .then((fn) => {
          if (disposed) {
            fn()
          } else {
            unlisten = fn
          }
        })
        .catch((e) => console.warn('[CpaWebView] auto-login status listener failed', e))

      return () => {
        disposed = true
        unlisten?.()
      }
    }, [onAutoLoginError])

    useEffect(() => {
      if (!visible) {
        wvRef.current?.hide()
        return
      }
      const t = setTimeout(() => spawn(url), 150)
      return () => {
        clearTimeout(t)
        invalidateSpawnToken()
        injectedAutoLoginKeyRef.current = null
        wvRef.current?.close()
        wvRef.current = null
      }
    }, [invalidateSpawnToken, spawn, url, visible])

    useEffect(() => {
      const win = getNativeWindow()
      if (!win) return
      let disposed = false
      let resizeUnlisten: (() => void) | null = null
      let focusUnlisten: (() => void) | null = null

      win
        .onResized(async () => {
          const wv = wvRef.current
          if (!wv) return
          const { width, height } = await getLogicalSize(win)
          await wv.setPosition(new LogicalPosition(SIDEBAR_W, 0))
          await wv.setSize(new LogicalSize(width, height))
        })
        .then((fn) => {
          if (disposed) {
            fn()
          } else {
            resizeUnlisten = fn
          }
        })

      win
        .onFocusChanged(async ({ payload: focused }) => {
          if (!focused) return
          const wv = wvRef.current
          if (wv && visibleRef.current) {
            await wv.show()
            await wv.setFocus().catch(() => {})
          }
        })
        .then((fn) => {
          if (disposed) {
            fn()
          } else {
            focusUnlisten = fn
          }
        })

      return () => {
        disposed = true
        resizeUnlisten?.()
        focusUnlisten?.()
      }
    }, [])

    return <div className="w-full h-full" />
  },
)

CpaWebView.displayName = 'CpaWebView'
