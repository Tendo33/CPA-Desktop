import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  detectInstallSources,
  externalUpdateInstructions,
  getInstallSourceInfo,
  setInstallSource,
  startCpa,
  upgradeViaBrew,
  validateInstallSource,
  type DetectionReport,
  type ExternalUpdateInstructions,
  type InstallSource,
  type InstallSourceInfo,
} from '@/lib/tauri'
import { Button, Input, Modal, Pill, Row, Section } from '@/components/ui'
import { useT } from '@/lib/i18n'

function kindTone(s: InstallSource): 'accent' | 'run' | 'neutral' {
  if (s.kind === 'managed') return 'accent'
  if (s.kind === 'homebrew') return 'run'
  return 'neutral'
}

interface InstallSourceCardProps {
  defaultOpen?: boolean
}

export function InstallSourceCard({ defaultOpen = true }: InstallSourceCardProps = {}) {
  const t = useT()
  const kindLabel = (s: InstallSource): string => t.installSource.kind[s.kind]
  const [info, setInfo] = useState<InstallSourceInfo | null>(null)
  const [detection, setDetection] = useState<DetectionReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [brewOpen, setBrewOpen] = useState(false)
  const [brewLog, setBrewLog] = useState('')
  const [externalOpen, setExternalOpen] = useState(false)
  const [external, setExternal] = useState<ExternalUpdateInstructions | null>(null)
  const [open, setOpen] = useState(defaultOpen)

  const refresh = () => {
    getInstallSourceInfo()
      .then(setInfo)
      .catch((e) => setMsg(String(e)))
  }

  useEffect(() => {
    refresh()
    detectInstallSources()
      .then(setDetection)
      .catch(() => {})

    const unlistenP = listen<string>('install:brew-line', (ev) => {
      setBrewLog((prev) => prev + ev.payload + '\n')
    })
    return () => {
      unlistenP.then((f) => f()).catch(() => {})
    }
  }, [])

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 3500)
  }

  const handleSwitch = async (source: InstallSource) => {
    setBusy(true)
    try {
      const errs = await validateInstallSource(source)
      if (errs.length > 0) {
        flash(`${t.installSource.invalid}: ${errs.join('; ')}`)
        return
      }
      await setInstallSource(source)
      refresh()
      flash(t.installSource.switched(kindLabel(source)))
    } catch (e) {
      flash(String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleRedetect = async () => {
    setBusy(true)
    try {
      setDetection(await detectInstallSources())
    } finally {
      setBusy(false)
    }
  }

  const handleBrewUpgrade = async () => {
    setBrewLog('')
    setBrewOpen(true)
    try {
      await upgradeViaBrew()
      setBrewLog((prev) => prev + '\n[done]')
      // Mirror About.tsx: restart CPA so the user lands in the running
      // state rather than having to manually press Start.
      setTimeout(() => {
        startCpa().catch(() => {})
      }, 500)
    } catch (e) {
      setBrewLog((prev) => prev + `\n[error] ${e}`)
    }
  }

  const handleShowExternal = async () => {
    try {
      setExternal(await externalUpdateInstructions())
      setExternalOpen(true)
    } catch (e) {
      flash(String(e))
    }
  }

  if (!info) return null

  const current = info.source
  return (
    <Section
      title={t.installSource.title}
      action={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRedetect} disabled={busy}>
            {t.installSource.redetect}
          </Button>
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {open ? t.settings.hideDetails : t.settings.showDetails}
          </Button>
        </div>
      }
    >
      <Row first label={t.installSource.currentLabel} hint={t.installSource.currentHint}>
        <Pill tone={kindTone(current)}>{kindLabel(current)}</Pill>
      </Row>

      {open && (
        <>
          <Row label={t.installSource.binary} hint={info.paths.binary}>
            <span />
          </Row>
          <Row label={t.installSource.config} hint={info.paths.config}>
            <span />
          </Row>
          <Row label={t.installSource.workingDir} hint={info.paths.workingDir}>
            <span />
          </Row>

          {info.validationErrors.length > 0 && (
            <Row label={t.installSource.validation} hint={info.validationErrors.join('; ')}>
              <Pill tone="err">!</Pill>
            </Row>
          )}

          {/* Switch options */}
          <Row label={t.installSource.switchTo} hint={t.installSource.switchHint}>
            <div className="flex gap-2 flex-wrap justify-end">
              <Button
                size="sm"
                variant={current.kind === 'managed' ? 'primary' : 'ghost'}
                disabled={busy || current.kind === 'managed'}
                onClick={() => handleSwitch({ kind: 'managed' })}
              >
                {t.installSource.kind.managed}
              </Button>
              {detection?.homebrew && (
                <Button
                  size="sm"
                  variant={current.kind === 'homebrew' ? 'primary' : 'ghost'}
                  disabled={busy || current.kind === 'homebrew'}
                  onClick={() => handleSwitch(detection.homebrew!.source)}
                  title={detection.homebrew.note ?? undefined}
                >
                  {t.installSource.kind.homebrew}
                </Button>
              )}
              {detection?.systemPath && (
                <Button
                  size="sm"
                  variant={current.kind === 'systemPath' ? 'primary' : 'ghost'}
                  disabled={busy || current.kind === 'systemPath'}
                  onClick={() => handleSwitch(detection.systemPath!.source)}
                  title={detection.systemPath.note ?? undefined}
                >
                  {t.installSource.kind.systemPath}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setCustomOpen(true)}>
                {`${t.installSource.kind.custom}…`}
              </Button>
            </div>
          </Row>

          {/* Update action */}
          {info.strategy === 'brewUpgrade' && (
            <Row label={t.installSource.updateAction} hint={t.installSource.brewHint}>
              <Button size="sm" onClick={handleBrewUpgrade}>
                {t.installSource.brewUpgrade}
              </Button>
            </Row>
          )}
          {info.strategy === 'externalNotice' && (
            <Row label={t.installSource.updateAction} hint={t.installSource.externalHint}>
              <Button size="sm" variant="ghost" onClick={handleShowExternal}>
                {t.installSource.showInstructions}
              </Button>
            </Row>
          )}
        </>
      )}

      {msg && (
        <Row label="" hint={msg}>
          <span />
        </Row>
      )}

      <CustomModal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onSave={async (s) => {
          setCustomOpen(false)
          await handleSwitch(s)
        }}
      />

      <Modal open={brewOpen} onClose={() => setBrewOpen(false)} title="brew upgrade cliproxyapi">
        <pre
          className="max-h-[320px] min-h-[120px] overflow-auto rounded bg-raised p-2 text-[11px] text-text-2 whitespace-pre-wrap break-all"
          style={{ fontFamily: 'ui-monospace, monospace' }}
        >
          {brewLog || '…'}
        </pre>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setBrewOpen(false)}>
            {t.installSource.close}
          </Button>
        </div>
      </Modal>

      <Modal
        open={externalOpen}
        onClose={() => setExternalOpen(false)}
        title={t.installSource.externalHeading[current.kind]}
      >
        <pre
          className="rounded bg-raised p-2 text-[11px] text-text-2 whitespace-pre"
          style={{ fontFamily: 'ui-monospace, monospace' }}
        >
          {(external?.commands ?? []).join('\n')}
        </pre>
        <div className="mt-3 flex justify-between items-center">
          {external?.link && (
            <a
              href={external.link}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-accent hover:underline"
            >
              {t.installSource.docs}
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText((external?.commands ?? []).join('\n')).catch(() => {})
            }}
          >
            {t.installSource.copy}
          </Button>
        </div>
      </Modal>
    </Section>
  )
}

function CustomModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (s: InstallSource) => void
}) {
  const t = useT()
  const [binary, setBinary] = useState('')
  const [config, setConfig] = useState('')
  const [workingDir, setWorkingDir] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [validating, setValidating] = useState(false)

  const reset = () => {
    setBinary('')
    setConfig('')
    setWorkingDir('')
    setErrors([])
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    const source: InstallSource = {
      kind: 'custom',
      binary,
      config,
      workingDir,
    }
    setValidating(true)
    try {
      const errs = await validateInstallSource(source)
      if (errs.length > 0) {
        setErrors(errs)
        return
      }
      reset()
      onSave(source)
    } catch (e) {
      setErrors([String(e)])
    } finally {
      setValidating(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={t.installSource.customTitle}>
      <div className="flex flex-col gap-2">
        <label className="text-[11px] text-text-3">{t.installSource.binary}</label>
        <Input
          value={binary}
          onChange={(e) => setBinary(e.target.value)}
          placeholder="/usr/local/bin/cli-proxy-api"
        />
        <label className="text-[11px] text-text-3">{t.installSource.config}</label>
        <Input
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          placeholder="/etc/cliproxyapi.conf"
        />
        <label className="text-[11px] text-text-3">{t.installSource.workingDir}</label>
        <Input
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="/var/cliproxyapi"
        />
        {errors.length > 0 && (
          <div className="rounded bg-err-bg border border-err-border p-2 text-[11px] text-err">
            {errors.join('\n')}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {t.installSource.cancel}
          </Button>
          <Button size="sm" onClick={submit} disabled={validating || !binary || !config}>
            {t.installSource.save}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
