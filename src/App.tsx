import { useEffect, useRef, useState } from 'react'
import { Sidebar, type Page } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { FirstRunSetup } from '@/components/FirstRunSetup'
import { Dashboard } from '@/pages/Dashboard'
import { Logs } from '@/pages/Logs'
import { SettingsPage } from '@/pages/Settings'
import { AboutPage } from '@/pages/About'
import { useCpaStore } from '@/stores/cpa'
import { useLogStore } from '@/stores/logs'
import { useSettingsStore } from '@/stores/settings'
import { cpaBinaryExists } from '@/lib/tauri'
import type { UnlistenFn } from '@tauri-apps/api/event'

export default function App() {
  const [page, setPage]               = useState<Page>('dashboard')
  const [binaryReady, setBinaryReady] = useState<boolean | null>(null)
  const [, setPrevPage]               = useState<Page>('dashboard')

  const { initialize: initCpa } = useCpaStore()
  const { initialize: initLogs } = useLogStore()
  const unlistenRefs = useRef<UnlistenFn[]>([])

  const theme = useSettingsStore((s) => s.theme)

  // Apply theme to document root so CSS :root[data-theme] selector works
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    cpaBinaryExists().then(setBinaryReady)
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

  if (binaryReady === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--c-bg)',
      }}>
        <div style={{
          width: 18, height: 18,
          border: '1.5px solid var(--c-border)',
          borderTopColor: 'var(--c-accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  if (!binaryReady) {
    return <FirstRunSetup onComplete={() => setBinaryReady(true)} />
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: 'var(--c-bg)',
      overflow: 'hidden',
    }}>
      <Sidebar current={page} onChange={handlePageChange} />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <main
          key={page}
          className="page-fade"
          style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {page === 'dashboard' && <Dashboard />}
          {page === 'logs'      && <Logs />}
          {page === 'settings'  && <SettingsPage />}
          {page === 'about'     && <AboutPage />}
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
