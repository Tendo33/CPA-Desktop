import { useEffect, useRef, useState } from 'react'
import { Sidebar, type Page } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { FirstRunSetup } from '@/components/FirstRunSetup'
import { Toaster } from '@/components/ui'
import { Dashboard } from '@/pages/Dashboard'
import { Logs } from '@/pages/Logs'
import { SettingsPage } from '@/pages/Settings'
import { AboutPage } from '@/pages/About'
import { useCpaStore } from '@/stores/cpa'
import { useLogStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import {
  applyAppUpdate,
  checkAppUpdate,
  cpaBinaryExists,
  getInstallSourceInfo,
  getSettings,
} from '@/lib/tauri'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { register, unregister } from '@tauri-apps/plugin-global-shortcut'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [binaryReady, setBinaryReady] = useState<boolean | null>(null)
  const [, setPrevPage] = useState<Page>('dashboard')

  const { initialize: initCpa } = useCpaStore()
  const { initialize: initLogs } = useLogStore()
  const unlistenRefs = useRef<UnlistenFn[]>([])

  const theme = useSettingsStore((s) => s.theme)

  // Apply theme; honor 'system' by reading prefers-color-scheme
  useEffect(() => {
    const apply = () => {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      const eff = theme === 'system' ? sys : theme
      document.documentElement.setAttribute('data-theme', eff)
    }
    apply()
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (theme === 'system') apply()
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    // First-run setup is the managed download flow. For external install
    // sources (Homebrew / SystemPath / Custom) we trust the user — even
    // if validation fails, the Settings → Install Source card will guide
    // them; we don't pop the managed-download wizard.
    void (async () => {
      try {
        const info = await getInstallSourceInfo()
        if (info.source.kind !== 'managed') {
          setBinaryReady(true)
          return
        }
      } catch (err) {
        console.error('getInstallSourceInfo failed; falling back to legacy probe', err)
      }
      const exists = await cpaBinaryExists().catch(() => false)
      setBinaryReady(exists)
    })()
  }, [])

  useEffect(() => {
    if (binaryReady === null) return
    initCpa().then((fn) => unlistenRefs.current.push(fn))
    initLogs().then((fn) => unlistenRefs.current.push(fn))
    return () => {
      unlistenRefs.current.forEach((fn) => fn())
      unlistenRefs.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binaryReady])

  const handlePageChange = (p: Page) => {
    setPrevPage(page)
    setPage(p)
  }

  useEffect(() => {
    if (binaryReady !== true) return
    let cancelled = false
    const bindings: Array<[string, () => void]> = [
      ['CmdOrCtrl+,', () => setPage('settings')],
      ['CmdOrCtrl+L', () => setPage('logs')],
    ]
    void (async () => {
      for (const [key, fn] of bindings) {
        if (cancelled) return
        try {
          await register(key, fn)
        } catch {
          /* shortcut may already be registered by another app */
        }
      }
    })()
    return () => {
      cancelled = true
      bindings.forEach(([key]) => {
        unregister(key).catch(() => {})
      })
    }
  }, [binaryReady])

  useEffect(() => {
    if (binaryReady !== true) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    void getSettings().then(async (s) => {
      if (cancelled || !s.autoCheckAppUpdates) return
      timer = setTimeout(
        async () => {
          try {
            const u = await checkAppUpdate()
            if (u) {
              const notif = await import('@tauri-apps/plugin-notification')
              const granted = await notif.isPermissionGranted()
              if (granted) {
                await notif.sendNotification({
                  title: 'CPA Desktop update available',
                  body: `v${u.version}`,
                })
              }
            }
          } catch {
            /* swallow */
          }
        },
        6 * 60 * 60 * 1000,
      )
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [binaryReady])

  useEffect(() => {
    if (binaryReady !== true) return
    let unlisten: UnlistenFn | null = null
    void listen('app:check-updates', async () => {
      try {
        const u = await checkAppUpdate()
        if (!u) return
        if (confirm(`Update ${u.version} available. Install now?`)) {
          await applyAppUpdate(u)
        }
      } catch {
        /* swallow */
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [binaryReady])

  if (binaryReady === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--c-bg)',
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            border: '1.5px solid var(--c-border)',
            borderTopColor: 'var(--c-accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    )
  }

  if (!binaryReady) {
    return <FirstRunSetup onComplete={() => setBinaryReady(true)} />
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        style={{
          display: 'flex',
          height: '100vh',
          background: 'var(--c-bg)',
          overflow: 'hidden',
        }}
      >
        <Sidebar current={page} onChange={handlePageChange} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.main
              key={page}
              initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {page === 'dashboard' && <Dashboard />}
              {page === 'logs' && <Logs />}
              {page === 'settings' && <SettingsPage />}
              {page === 'about' && <AboutPage />}
            </motion.main>
          </AnimatePresence>
          <StatusBar />
        </div>
        <Toaster />
      </div>
    </MotionConfig>
  )
}
