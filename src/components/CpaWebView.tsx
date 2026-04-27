import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'

export interface CpaWebViewHandle {
  reload: () => void
}

interface Props {
  url: string
  visible: boolean
}

const LABEL = 'cpa-content'
// Sidebar width in logical pixels
const SIDEBAR_W = 56
// Status bar height in logical pixels
const STATUS_H = 28

async function getLogicalSize() {
  const win = getCurrentWindow()
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

async function spawnWebview(url: string): Promise<Webview> {
  await closeExisting()
  const win = getCurrentWindow()
  const { width, height } = await getLogicalSize()

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

export const CpaWebView = forwardRef<CpaWebViewHandle, Props>(({ url, visible }, ref) => {
  const wvRef = useRef<Webview | null>(null)
  const tokenRef = useRef(0)
  // Keep a ref so spawn() closure always sees latest visible
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const spawn = (u: string) => {
    const token = ++tokenRef.current
    spawnWebview(u)
      .then((wv) => {
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
      })
      .catch(console.error)
  }

  useImperativeHandle(ref, () => ({ reload: () => spawn(url) }))

  // Spawn when url changes while visible, or when visible becomes true.
  // When visible becomes false, just hide the existing webview.
  // This ensures the webview always loads a fresh URL when CPA starts running.
  useEffect(() => {
    if (!visible) {
      wvRef.current?.hide()
      return
    }
    const t = setTimeout(() => spawn(url), 150)
    return () => {
      clearTimeout(t)
      // tokenRef.current is intentionally read at cleanup time to invalidate
      // any in-flight spawn promise; copying it would defeat that purpose.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      tokenRef.current++
      wvRef.current?.close()
      wvRef.current = null
    }
  }, [url, visible])

  // Resize handler
  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | null = null

    win
      .onResized(async () => {
        const wv = wvRef.current
        if (!wv) return
        const { width, height } = await getLogicalSize()
        await wv.setPosition(new LogicalPosition(SIDEBAR_W, 0))
        await wv.setSize(new LogicalSize(width, height))
      })
      .then((fn) => {
        unlisten = fn
      })

    // When window is focused, ensure webview is visible (if it should be)
    win
      .onFocusChanged(async ({ payload: focused }) => {
        if (!focused) return
        const wv = wvRef.current
        if (wv && visible) {
          await wv.show()
          await wv.setFocus().catch(() => {})
        }
      })
      .then((fn) => {
        const prev = unlisten
        unlisten = () => {
          prev?.()
          fn()
        }
      })

    return () => {
      unlisten?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="w-full h-full" />
})

CpaWebView.displayName = 'CpaWebView'
