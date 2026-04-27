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
import { cpaBinaryExists } from '@/lib/tauri'
import type { UnlistenFn } from '@tauri-apps/api/event'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [binaryReady, setBinaryReady] = useState<boolean | null>(null)

  const { initialize: initCpa } = useCpaStore()
  const { initialize: initLogs } = useLogStore()

  const unlistenRefs = useRef<UnlistenFn[]>([])

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

  // Loading state
  if (binaryReady === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    )
  }

  // First run — binary not present
  if (!binaryReady) {
    return (
      <FirstRunSetup
        onComplete={() => {
          setBinaryReady(true)
        }}
      />
    )
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar current={page} onChange={setPage} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {page === 'dashboard' && <Dashboard />}
          {page === 'logs' && <Logs />}
          {page === 'settings' && <SettingsPage />}
          {page === 'about' && <AboutPage />}
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
