import { useEffect, useRef, useState } from 'react'
import { Sidebar, type Page } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { SetupWizard } from '@/components/setup/SetupWizard'
import { Toaster } from '@/components/ui'
import { Dashboard } from '@/pages/Dashboard'
import { Logs } from '@/pages/Logs'
import { AuthFilesPage } from '@/pages/AuthFiles'
import { SettingsPage } from '@/pages/Settings'
import { AboutPage } from '@/pages/About'
import { useCpaStore } from '@/stores/cpa'
import { useLogStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import {
  applyAppUpdate,
  checkAppUpdate,
  detectInstallSources,
  getSettings,
  getSetupStatus,
  setInstallSource,
  type SetupStatus,
} from '@/lib/tauri'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { register, unregister } from '@tauri-apps/plugin-global-shortcut'

type BootState =
  | { kind: 'probing' }
  | { kind: 'needsSetup'; status: SetupStatus }
  | { kind: 'ready' }

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [boot, setBoot] = useState<BootState>({ kind: 'probing' })
  const [, setPrevPage] = useState<Page>('dashboard')

  const { initialize: initCpa } = useCpaStore()
  const { initialize: initLogs } = useLogStore()
  const unlistenRefs = useRef<UnlistenFn[]>([])

  const theme = useSettingsStore((s) => s.theme)
  const t = useT()

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
    // Boot probe — decide whether to show the setup wizard or the main
    // app. The rules:
    //   1. Something is already answering on the configured port (e.g.
    //      `brew services start cliproxyapi`). Just attach.
    //   2. External install source (Homebrew / SystemPath / Custom) →
    //      trust the user. They're responsible for config.yaml and
    //      secret-key. The dashboard's mgmt-unavailable overlay (Phase 3)
    //      will surface problems if any.
    //   3. Managed source: if a Homebrew/SystemPath install is detected
    //      on disk, switch to it (zero-touch upgrade path) and skip.
    //   4. Otherwise, run the wizard if anything is missing: binary,
    //      config.yaml, secret-key, or real api-keys.
    void (async () => {
      try {
        const status = await getSetupStatus()
        if (status.cpaAlreadyRunning) {
          setBoot({ kind: 'ready' })
          return
        }
        if (status.installSourceKind !== 'managed') {
          setBoot({ kind: 'ready' })
          return
        }
        // Try zero-touch upgrade: if Homebrew or SystemPath is present
        // and we've never run, switch to it before deciding.
        if (!status.binaryPresent) {
          const detected = await detectInstallSources().catch(() => null)
          const candidate = detected?.homebrew?.source ?? detected?.systemPath?.source ?? null
          if (candidate) {
            await setInstallSource(candidate).catch((e) =>
              console.error('auto-switch install source failed', e),
            )
            setBoot({ kind: 'ready' })
            return
          }
        }
        const setupComplete =
          status.binaryPresent &&
          status.configPresent &&
          status.secretKeySet &&
          status.apiKeysConfigured
        setBoot(setupComplete ? { kind: 'ready' } : { kind: 'needsSetup', status })
      } catch (err) {
        console.error('setup probe failed; assuming ready', err)
        // Best-effort fallback: if we can't probe, get the user into the
        // main app rather than block them. The dashboard overlay will
        // tell them what's wrong if anything actually is.
        setBoot({ kind: 'ready' })
      }
    })()
  }, [])

  useEffect(() => {
    if (boot.kind === 'probing') return
    initCpa().then((fn) => unlistenRefs.current.push(fn))
    initLogs().then((fn) => unlistenRefs.current.push(fn))
    return () => {
      unlistenRefs.current.forEach((fn) => fn())
      unlistenRefs.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.kind])

  const handlePageChange = (p: Page) => {
    setPrevPage(page)
    setPage(p)
  }

  // Cross-component navigation (e.g. Dashboard's mgmt-unavailable overlay
  // jumping to Settings). Avoids prop drilling through Sidebar/Pages.
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<{ page?: Page }>).detail
      if (detail?.page) handlePageChange(detail.page)
    }
    window.addEventListener('cpa-navigate', onNav)
    return () => window.removeEventListener('cpa-navigate', onNav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const ready = boot.kind === 'ready'

  useEffect(() => {
    if (!ready) return
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
  }, [ready])

  useEffect(() => {
    if (!ready) return
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
                  title: t.appUpdate.notificationTitle,
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
  }, [ready, t])

  useEffect(() => {
    if (!ready) return
    let unlisten: UnlistenFn | null = null
    void listen('app:check-updates', async () => {
      try {
        const u = await checkAppUpdate()
        if (!u) return
        if (confirm(t.appUpdate.confirmInstall(u.version))) {
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
  }, [ready, t])

  if (boot.kind === 'probing') {
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

  if (boot.kind === 'needsSetup') {
    return <SetupWizard initial={boot.status} onComplete={() => setBoot({ kind: 'ready' })} />
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
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {page === 'dashboard' && <Dashboard />}
              {page === 'logs' && <Logs />}
              {page === 'authFiles' && <AuthFilesPage />}
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
