import { forwardRef, useCallback, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff, Copy, RefreshCw, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toast'
import { useT } from '@/lib/i18n'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** When provided, renders a "regenerate" icon button next to the eye toggle. */
  onRegenerate?: () => void | Promise<void>
  /** Whether to show the copy button. Defaults to true. */
  copyable?: boolean
  /** Optional className for the wrapper. */
  wrapperClassName?: string
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ onRegenerate, copyable = true, wrapperClassName, className, value, ...rest }, ref) => {
    const t = useT()
    const [revealed, setRevealed] = useState(false)
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(async () => {
      const text = String(value ?? '')
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        toast.success(t.common.copiedToClipboard)
        setTimeout(() => setCopied(false), 1500)
      } catch (e) {
        toast.error(t.common.copyFailed(String(e)))
      }
    }, [t, value])

    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-raised pl-3 pr-1.5 h-10 min-w-0',
          'focus-within:border-accent-dim focus-within:outline-2 focus-within:outline-accent transition-colors',
          wrapperClassName,
        )}
      >
        <input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          value={value}
          className={cn(
            'flex-1 bg-transparent border-0 outline-none text-text-1 text-[13px] font-log min-w-0',
            className,
          )}
          {...rest}
        />
        <IconButton
          title={revealed ? t.common.hide : t.common.reveal}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? (
            <EyeOff size={12} strokeWidth={1.75} />
          ) : (
            <Eye size={12} strokeWidth={1.75} />
          )}
        </IconButton>
        {copyable && (
          <IconButton title={t.common.copy} onClick={handleCopy}>
            {copied ? (
              <Check size={12} strokeWidth={2} className="text-run" />
            ) : (
              <Copy size={12} strokeWidth={1.75} />
            )}
          </IconButton>
        )}
        {onRegenerate && (
          <IconButton title={t.common.regenerate} onClick={() => void onRegenerate()}>
            <RefreshCw size={12} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex items-center justify-center w-9 h-9 rounded-md text-text-3 hover:text-text-1 hover:bg-hover transition-colors"
    >
      {children}
    </button>
  )
}
