import { Plus, Trash2, RefreshCw, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button'
import { PasswordInput } from './PasswordInput'
import { generateSecret } from '@/lib/tauri'
import { toast } from '@/stores/toast'
import { useT } from '@/lib/i18n'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  /** Disable the "add" button when at this many entries (UX guardrail). */
  max?: number
}

export function ApiKeyList({ value, onChange, max = 16 }: Props) {
  const t = useT()
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const handleAdd = async () => {
    try {
      const k = await generateSecret()
      onChange([...value, k])
    } catch (e) {
      toast.error(t.common.generateFailed(String(e)))
    }
  }

  const handleRegenerate = async (idx: number) => {
    try {
      const k = await generateSecret()
      const next = [...value]
      next[idx] = k
      onChange(next)
    } catch (e) {
      toast.error(t.common.generateFailed(String(e)))
    }
  }

  const handleDelete = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  const handleEdit = (idx: number, v: string) => {
    const next = [...value]
    next[idx] = v
    onChange(next)
  }

  const handleCopy = async (idx: number, k: string) => {
    try {
      await navigator.clipboard.writeText(k)
      setCopiedIdx(idx)
      toast.success(t.common.copiedToClipboard)
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500)
    } catch (e) {
      toast.error(t.common.copyFailed(String(e)))
    }
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {value.length === 0 && (
        <div className="text-xs text-text-3 italic px-1 py-2">{t.configForm.noApiKeys}</div>
      )}
      {value.map((k, i) => (
        <div key={i} className="flex items-center gap-1.5 w-full">
          <PasswordInput
            value={k}
            onChange={(e) => handleEdit(i, e.target.value)}
            wrapperClassName="flex-1"
            copyable={false}
          />
          <button
            type="button"
            title={t.common.copy}
            aria-label={t.common.copy}
            onClick={() => handleCopy(i, k)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-raised text-text-3 hover:text-text-1 hover:bg-hover transition-colors shrink-0"
          >
            {copiedIdx === i ? (
              <Check size={12} strokeWidth={2} className="text-run" />
            ) : (
              <Copy size={12} strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            title={t.common.regenerate}
            aria-label={t.common.regenerate}
            onClick={() => handleRegenerate(i)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-raised text-text-3 hover:text-text-1 hover:bg-hover transition-colors shrink-0"
          >
            <RefreshCw size={12} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t.common.delete}
            aria-label={t.common.delete}
            onClick={() => handleDelete(i)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-raised text-text-3 hover:text-err hover:border-err-border transition-colors shrink-0"
          >
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleAdd}
          disabled={value.length >= max}
        >
          <Plus size={12} strokeWidth={1.75} />
          {t.configForm.generateNewKey}
        </Button>
        {value.length >= max && (
          <span className="text-[11px] text-text-3">{t.configForm.maxKeys(max)}</span>
        )}
      </div>
    </div>
  )
}
