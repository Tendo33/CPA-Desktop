import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}

export function Toggle({ checked, onChange, disabled, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn('toggle', checked && 'on', disabled && 'opacity-40 cursor-not-allowed')}
    >
      <span className="toggle-thumb" />
    </button>
  )
}
