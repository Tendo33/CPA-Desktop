import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getSettings,
  initializeCredentials,
  openLogsFolder,
  saveSettings,
  startCpa,
  writeConfigYamlPort,
  type AppSettings,
  type SetupStatus,
} from '@/lib/tauri'
import type { CpaStatus } from '@/types/cpa'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui'
import { DownloadStep } from './steps/DownloadStep'
import { ConfigureStep } from './steps/ConfigureStep'
import { DoneStep } from './steps/DoneStep'

interface Props {
  initial: SetupStatus
  onComplete: () => void
}

type Phase = 'download' | 'configure' | 'launching' | 'launchFailed' | 'done'

export function SetupWizard({ initial, onComplete }: Props) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>(() =>
    initial.binaryPresent ? 'configure' : 'download',
  )
  const [credentials, setCredentials] = useState<{ secretKey: string; apiKeys: string[] } | null>(
    null,
  )
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void getSettings().then(setSettings)
  }, [])

  // Subscribe to CPA status while we're trying to launch so we know when
  // to advance to "done" or "launchFailed".
  useEffect(() => {
    if (phase !== 'launching') return
    let unlisten: (() => void) | null = null
    void listen<CpaStatus>('cpa:status', (e) => {
      const s = e.payload
      if (s.kind === 'Running') {
        setPhase('done')
      } else if (s.kind === 'Error') {
        setLaunchError(s.data)
        setPhase('launchFailed')
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [phase])

  const steps = useMemo(() => {
    const list: Array<{ key: Phase; label: string }> = []
    if (!initial.binaryPresent) list.push({ key: 'download', label: t.setup.stepDownload })
    list.push({ key: 'configure', label: t.setup.stepConfigure })
    list.push({ key: 'launching', label: t.setup.stepLaunch })
    return list
  }, [initial.binaryPresent, t])

  const activeStepIdx = (() => {
    if (phase === 'download') return steps.findIndex((s) => s.key === 'download')
    if (phase === 'configure') return steps.findIndex((s) => s.key === 'configure')
    return steps.length - 1 // launching / launchFailed / done all map to last
  })()

  const handleDownloadDone = () => setPhase('configure')

  const handleConfigureSubmit = async (port: number, autoStart: boolean) => {
    setLaunchError(null)
    try {
      // Persist port to both app settings and config.yaml.
      const current = settings ?? (await getSettings())
      const next = { ...current, port, autoStart }
      await saveSettings(next)
      await writeConfigYamlPort(port)
      // Generate / read secret-key + api-keys atomically and stamp into yaml.
      const creds = await initializeCredentials()
      setCredentials(creds)
      setSettings(next)
      setPhase('launching')
      await startCpa()
    } catch (e) {
      setLaunchError(String(e))
      setPhase('launchFailed')
    }
  }

  const handleRetryLaunch = async () => {
    setLaunchError(null)
    setPhase('launching')
    try {
      await startCpa()
    } catch (e) {
      setLaunchError(String(e))
      setPhase('launchFailed')
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--c-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        animation: 'fade-in 300ms ease both',
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <Header
          title={t.setup.title}
          subtitle={t.setup.subtitle}
          steps={steps}
          activeIdx={activeStepIdx}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {phase === 'download' && <DownloadStep onDone={handleDownloadDone} />}

            {phase === 'configure' && (
              <ConfigureStep
                defaultPort={settings?.port ?? 8317}
                defaultAutoStart={settings?.autoStart ?? true}
                onSubmit={handleConfigureSubmit}
              />
            )}

            {phase === 'launching' && (
              <CenteredCard>
                <Spinner />
                <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 12 }}>
                  {t.setup.initializing}
                </p>
              </CenteredCard>
            )}

            {phase === 'launchFailed' && (
              <CenteredCard>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text-1)' }}>
                  {t.setup.launchFailed}
                </h3>
                {launchError && (
                  <pre
                    className="font-log selectable"
                    style={{
                      fontSize: 11,
                      color: 'var(--c-err)',
                      background: 'var(--c-err-bg)',
                      border: '1px solid var(--c-err-border)',
                      padding: '10px 12px',
                      borderRadius: 6,
                      maxHeight: 160,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 12,
                    }}
                  >
                    {launchError}
                  </pre>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <Button onClick={handleRetryLaunch}>{t.setup.launchFailedRetry}</Button>
                  <Button variant="ghost" onClick={() => void openLogsFolder()}>
                    {t.setup.launchFailedOpenLogs}
                  </Button>
                </div>
              </CenteredCard>
            )}

            {phase === 'done' && credentials && (
              <DoneStep credentials={credentials} onContinue={onComplete} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Header({
  title,
  subtitle,
  steps,
  activeIdx,
}: {
  title: string
  subtitle: string
  steps: Array<{ key: string; label: string }>
  activeIdx: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <Brand />
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: 'var(--c-text-1)',
          letterSpacing: 0,
          textAlign: 'center',
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--c-text-3)',
          textAlign: 'center',
          lineHeight: 1.6,
          maxWidth: 320,
          margin: 0,
        }}
      >
        {subtitle}
      </p>
      <Stepper steps={steps} activeIdx={activeIdx} />
    </div>
  )
}

function Brand() {
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        background: 'var(--c-accent-bg)',
        border: '1px solid var(--c-accent-dim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 8px 32px var(--c-accent-bg)',
      }}
    >
      <span
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--c-accent)',
          letterSpacing: 0,
        }}
      >
        C
      </span>
    </div>
  )
}

function Stepper({
  steps,
  activeIdx,
}: {
  steps: Array<{ key: string; label: string }>
  activeIdx: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      {steps.map((s, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  fontSize: 10,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done
                    ? 'var(--c-accent)'
                    : active
                      ? 'var(--c-accent-bg)'
                      : 'var(--c-raised)',
                  color: done ? 'var(--c-bg)' : active ? 'var(--c-accent)' : 'var(--c-text-3)',
                  border: active ? '1px solid var(--c-accent-dim)' : '1px solid var(--c-border)',
                  transition: 'all 200ms ease',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: active ? 'var(--c-text-1)' : 'var(--c-text-3)',
                  fontWeight: active ? 500 : 400,
                }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 18,
                  height: 1,
                  background: 'var(--c-border)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Spinner() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        border: '2px solid var(--c-border)',
        borderTopColor: 'var(--c-accent)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  )
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border-sub)',
        borderRadius: 10,
        padding: '24px 22px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}
