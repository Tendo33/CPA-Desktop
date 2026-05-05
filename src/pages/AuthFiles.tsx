import { useEffect, useMemo, useState } from 'react'
import { Download, Filter, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import {
  type AuthFileInfo,
  type ExportResult,
  createAuthSession,
  exportAuthFiles,
  listAuthFiles,
  readConfigField,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { isRunning } from '@/lib/cpaStatus'
import { useT } from '@/lib/i18n'
import { toast } from '@/stores/toast'

const PLAN_OPTIONS = ['all', 'free', 'team', 'plus', 'pro', 'enterprise', 'edu', 'unknown'] as const
type PlanFilter = (typeof PLAN_OPTIONS)[number]

const LS_CONCURRENCY = 'cpa.authFiles.concurrency'
const LS_TYPE = 'cpa.authFiles.type'
const LS_PLAN = 'cpa.authFiles.plan'
const LS_STATUS = 'cpa.authFiles.status'
const LS_SEARCH = 'cpa.authFiles.search'
const LS_FORMAT_CPA = 'cpa.authFiles.exportCpa'
const LS_FORMAT_SUB2API = 'cpa.authFiles.exportSub2api'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(decimals)} ${units[i]}`
}

function formatTime(s: string): string {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { hour12: false })
}

export function AuthFilesPage() {
  const { status } = useCpaStore()
  const cpaRunning = isRunning(status)
  const t = useT()

  const [password, setPassword] = useState('')
  const [concurrency, setConcurrency] = useState(
    () => Number(localStorage.getItem(LS_CONCURRENCY)) || 5,
  )
  const [type, setType] = useState(() => localStorage.getItem(LS_TYPE) ?? 'codex')
  const [plan, setPlan] = useState<PlanFilter>(
    () => (localStorage.getItem(LS_PLAN) as PlanFilter) ?? 'all',
  )
  const [statusFilter, setStatusFilter] = useState(() => localStorage.getItem(LS_STATUS) ?? 'all')
  const [search, setSearch] = useState(() => localStorage.getItem(LS_SEARCH) ?? '')
  const [exportCpa, setExportCpa] = useState(() => localStorage.getItem(LS_FORMAT_CPA) !== '0')
  const [exportSub2api, setExportSub2api] = useState(
    () => localStorage.getItem(LS_FORMAT_SUB2API) === '1',
  )
  const [items, setItems] = useState<AuthFileInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [statusText, setStatusText] = useState<string>(t.authFiles.emptyInitial)
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'warn' | 'error'>('info')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const createSession = async () => createAuthSession(password)

  useEffect(() => {
    localStorage.setItem(LS_CONCURRENCY, String(concurrency))
  }, [concurrency])
  useEffect(() => {
    localStorage.setItem(LS_TYPE, type)
  }, [type])
  useEffect(() => {
    localStorage.setItem(LS_PLAN, plan)
  }, [plan])
  useEffect(() => {
    localStorage.setItem(LS_STATUS, statusFilter)
  }, [statusFilter])
  useEffect(() => {
    localStorage.setItem(LS_SEARCH, search)
  }, [search])
  useEffect(() => {
    localStorage.setItem(LS_FORMAT_CPA, exportCpa ? '1' : '0')
  }, [exportCpa])
  useEffect(() => {
    localStorage.setItem(LS_FORMAT_SUB2API, exportSub2api ? '1' : '0')
  }, [exportSub2api])

  // Pull the management secret from config.yaml when the user hasn't
  // typed one yet. Done lazily on mount so a) we don't spam reads on
  // every keystroke and b) typing always wins over the auto-fill.
  useEffect(() => {
    if (password) return
    void readConfigField<string>('remote-management.secret-key')
      .then((v) => {
        if (typeof v === 'string' && v && !password) setPassword(v)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const typeNeedle = type.toLowerCase()
    const statusNeedle = statusFilter.toLowerCase()
    const planNeedle = plan.toLowerCase()
    const searchNeedle = search.trim().toLowerCase()
    return items.filter((it) => {
      if (typeNeedle !== 'all' && it.type !== typeNeedle) return false
      if (statusNeedle !== 'all' && it.status !== statusNeedle) return false
      if (planNeedle !== 'all' && (it.planType || 'unknown').toLowerCase() !== planNeedle)
        return false
      if (searchNeedle) {
        const hay = [
          it.name,
          it.fileName,
          it.account,
          it.email,
          it.label,
          it.type,
          it.status,
          it.planType,
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(searchNeedle)) return false
      }
      return true
    })
  }, [items, type, statusFilter, plan, search])

  const selectedVisibleCount = useMemo(
    () => filtered.filter((it) => selected.has(it.id)).length,
    [filtered, selected],
  )

  const allTypes = useMemo(
    () => Array.from(new Set(items.map((i) => i.type).filter(Boolean))).sort(),
    [items],
  )
  const allStatuses = useMemo(
    () => Array.from(new Set(items.map((i) => i.status).filter(Boolean))).sort(),
    [items],
  )

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (type !== 'all') labels.push(`${t.authFiles.type}: ${type}`)
    if (plan !== 'all') labels.push(`${t.authFiles.planLabel}: ${t.authFiles.plan[plan]}`)
    if (statusFilter !== 'all') labels.push(`${t.authFiles.status}: ${statusFilter}`)
    if (search.trim()) labels.push(`${t.authFiles.search}: ${search.trim()}`)
    if (concurrency !== 5) labels.push(`${t.authFiles.concurrency}: ${concurrency}`)
    return labels
  }, [concurrency, plan, search, statusFilter, t, type])

  const refresh = async () => {
    if (loading || exporting) return
    if (!cpaRunning) {
      setStatusText(t.authFiles.cpaNotRunning)
      setStatusTone('warn')
      return
    }
    setLoading(true)
    setStatusText(t.authFiles.refreshing)
    setStatusTone('info')
    try {
      const sessionId = await createSession()
      const list = await listAuthFiles(sessionId)
      setItems(list)
      setSelected((prev) => {
        const validIds = new Set(list.map((it) => it.id))
        const next = new Set<string>()
        prev.forEach((id) => {
          if (validIds.has(id)) next.add(id)
        })
        return next
      })
      setStatusText(`${t.authFiles.summaryTotal}: ${list.length}`)
      setStatusTone('success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusText(msg)
      setStatusTone('error')
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const doExport = async (scope: 'all' | 'selected') => {
    if (loading || exporting) return
    if (!exportCpa && !exportSub2api) {
      toast.error(t.authFiles.pickAtLeastOne)
      setStatusText(t.authFiles.pickAtLeastOne)
      setStatusTone('warn')
      return
    }
    const target = scope === 'selected' ? items.filter((it) => selected.has(it.id)) : filtered
    if (target.length === 0) {
      const msg = scope === 'selected' ? t.authFiles.nothingSelected : t.authFiles.nothingMatched
      toast.error(msg)
      setStatusText(msg)
      setStatusTone('warn')
      return
    }
    setExporting(true)
    setStatusText(t.authFiles.exporting)
    setStatusTone('info')
    try {
      const sessionId = await createSession()
      const res: ExportResult = await exportAuthFiles({
        sessionId,
        names: target.map((it) => it.sourceName),
        exportCpa,
        exportSub2api,
        concurrency,
      })
      handleExportResult(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusText(msg)
      setStatusTone('error')
      toast.error(msg)
    } finally {
      setExporting(false)
    }
  }

  const handleExportResult = (res: ExportResult) => {
    if (!res.saved) {
      const msg = res.writtenArchive ? t.authFiles.cancelled : t.authFiles.nothingMatched
      setStatusText(msg)
      setStatusTone('warn')
      return
    }
    const archive = res.writtenArchive ?? '-'
    const parts: string[] = [t.authFiles.saved(res.successCount, archive)]
    if (exportSub2api) {
      parts.push(t.authFiles.sub2apiSummary(res.sub2apiSuccess, res.sub2apiFailures.length))
    }
    if (res.failureCount > 0) {
      parts.push(t.authFiles.downloadFailed(res.failureCount))
    }
    const msg = parts.join(' · ')
    setStatusText(msg)
    setStatusTone(res.failureCount > 0 ? 'warn' : 'success')
    toast.success(msg)
  }

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      filtered.forEach((it) => {
        if (checked) next.add(it.id)
        else next.delete(it.id)
      })
      return next
    })
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const masterChecked = filtered.length > 0 && selectedVisibleCount === filtered.length
  const masterIndeterminate = selectedVisibleCount > 0 && selectedVisibleCount < filtered.length

  const busy = loading || exporting

  return (
    <div className="flex flex-col h-full bg-bg overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-4 border-b border-border-sub bg-surface">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold text-text-1 leading-tight">
              {t.authFiles.title}
            </h1>
            <p className="max-w-[68ch] text-[13px] text-text-3 leading-relaxed">
              {t.authFiles.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={refresh} disabled={busy}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loading ? t.authFiles.refreshing : t.authFiles.refresh}
            </Button>
          </div>
        </div>

        <div className="auth-control-panel">
          <div className="auth-credential-row">
            <div className="auth-secret-field">
              <Field label={t.authFiles.password} hint={t.authFiles.passwordHint}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </Field>
            </div>
            <div className="auth-filter-summary">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <SlidersHorizontal size={14} />
                {filtersOpen ? t.authFiles.hideFilters : t.authFiles.filters}
              </Button>
              <div className="auth-filter-chips" aria-label={t.authFiles.activeFilters}>
                {activeFilterLabels.length > 0 ? (
                  activeFilterLabels.map((label) => <FilterChip key={label}>{label}</FilterChip>)
                ) : (
                  <span className="text-[11px] text-text-3">{t.authFiles.noExtraFilters}</span>
                )}
              </div>
            </div>
          </div>

          {filtersOpen && (
            <div className="auth-filter-grid">
              <Field label={t.authFiles.concurrency}>
                <Input
                  type="number"
                  min={1}
                  max={32}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Number(e.target.value) || 1))}
                  disabled={busy}
                />
              </Field>
              <Field label={t.authFiles.type}>
                <Select value={type} onChange={setType} disabled={busy}>
                  <option value="all">{t.authFiles.allTypes}</option>
                  {allTypes.length === 0 && type !== 'all' ? (
                    <option value={type}>{type}</option>
                  ) : null}
                  {allTypes.map((tp) => (
                    <option key={tp} value={tp}>
                      {tp}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.authFiles.planLabel}>
                <Select value={plan} onChange={(v) => setPlan(v as PlanFilter)} disabled={busy}>
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {t.authFiles.plan[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.authFiles.status}>
                <Select value={statusFilter} onChange={setStatusFilter} disabled={busy}>
                  <option value="all">{t.authFiles.allStatuses}</option>
                  {allStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.authFiles.search}>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.authFiles.searchPlaceholder}
                  disabled={busy}
                />
              </Field>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="auth-export-panel">
            <div className="flex items-center gap-3 text-[12px] text-text-2 flex-wrap">
              <span className="font-semibold text-text-3 uppercase tracking-[0.08em] text-[11px]">
                {t.authFiles.formatTitle}
              </span>
              <FormatToggle
                label={t.authFiles.cpaFormat}
                checked={exportCpa}
                onChange={setExportCpa}
                disabled={busy}
              />
              <FormatToggle
                label={t.authFiles.sub2apiFormat}
                checked={exportSub2api}
                onChange={setExportSub2api}
                disabled={busy}
              />
            </div>
            <div className="auth-export-actions">
              <Button
                variant="ghost"
                onClick={() => toggleAllVisible(true)}
                disabled={busy || filtered.length === 0}
              >
                <Filter size={14} />
                {t.authFiles.selectVisible}
              </Button>
              {selected.size > 0 && (
                <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>
                  <Trash2 size={14} />
                  {t.authFiles.clearSelected}
                </Button>
              )}
              <Button onClick={() => doExport('all')} disabled={busy || filtered.length === 0}>
                <Download size={14} />
                {t.authFiles.exportAll}
              </Button>
              <Button onClick={() => doExport('selected')} disabled={busy || selected.size === 0}>
                <Download size={14} />
                {t.authFiles.exportSelected}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-[11px] text-text-3 flex-wrap">
          <span
            className={
              'px-2 py-0.5 rounded-md ' +
              (statusTone === 'success'
                ? 'bg-accent-bg text-accent'
                : statusTone === 'warn'
                  ? 'bg-err-bg text-err'
                  : statusTone === 'error'
                    ? 'bg-err-bg text-err'
                    : 'bg-raised text-text-2')
            }
          >
            {statusText}
          </span>
          <SummaryPill label={t.authFiles.summaryTotal} value={items.length} />
          <SummaryPill label={t.authFiles.summaryFiltered} value={filtered.length} />
          <SummaryPill label={t.authFiles.summarySelected} value={selected.size} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="min-w-[760px] w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface text-text-3 sticky top-0 z-10">
              <th className="w-10 px-2 py-2 border-b border-border-sub text-center">
                <input
                  type="checkbox"
                  aria-label={t.authFiles.toggleAllVisible}
                  className="checkbox-control"
                  checked={masterChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = masterIndeterminate
                  }}
                  onChange={(e) => toggleAllVisible(e.target.checked)}
                  disabled={busy || filtered.length === 0}
                />
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnFile}
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnType}
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnPlan}
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnStatus}
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnAccount}
              </th>
              <th className="px-2 py-2 border-b border-border-sub text-left font-semibold">
                {t.authFiles.columnUpdated}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-text-3">
                  {items.length === 0 ? t.authFiles.emptyInitial : t.authFiles.emptyAfterFilter}
                </td>
              </tr>
            ) : (
              filtered.map((it) => {
                const checked = selected.has(it.id)
                return (
                  <tr key={it.id} className="hover:bg-hover/60">
                    <td className="px-2 py-1.5 border-b border-border-sub text-center">
                      <input
                        type="checkbox"
                        className="checkbox-control"
                        checked={checked}
                        onChange={(e) => toggleOne(it.id, e.target.checked)}
                        disabled={busy}
                        aria-label={t.authFiles.selectFile(it.name)}
                      />
                    </td>
                    <td
                      className="px-2 py-1.5 border-b border-border-sub text-text-1 truncate max-w-[260px]"
                      title={it.name}
                    >
                      {it.name}
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-sub text-text-2">
                      {it.type || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-sub text-text-2">
                      {it.planType || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-sub text-text-2">
                      {it.status || '-'}
                    </td>
                    <td
                      className="px-2 py-1.5 border-b border-border-sub text-text-2 truncate max-w-[220px]"
                      title={it.account || it.email || it.label || '-'}
                    >
                      {it.account || it.email || it.label || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-border-sub text-text-2 tabular-nums">
                      <div>{formatTime(it.modtime)}</div>
                      <div className="text-text-3 text-[11px]">{formatBytes(it.size)}</div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
        {label}
      </span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-text-3">{hint}</span> : null}
    </label>
  )
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-10 min-w-0 px-3 rounded-md border border-border bg-raised text-text-1 text-[13px] focus:outline-none focus:border-accent-dim disabled:opacity-50"
    >
      {children}
    </select>
  )
}

function FormatToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={
        'inline-flex items-center gap-2 px-3 h-9 rounded-full border text-[12px] cursor-pointer transition-colors ' +
        (checked
          ? 'bg-accent-bg text-accent border-accent-dim'
          : 'bg-raised text-text-3 border-border')
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="checkbox-control m-0"
      />
      {label}
    </label>
  )
}

function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-raised px-2 py-0.5 text-[11px] text-text-2">
      {children}
    </span>
  )
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-raised text-text-2 tabular-nums">
      <span className="text-text-3">{label}</span>
      <span className="font-semibold text-text-1">{value}</span>
    </span>
  )
}
