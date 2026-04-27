import { LayoutDashboard, ScrollText, Settings, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Page = 'dashboard' | 'logs' | 'settings' | 'about'

const items: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'about', label: 'About', icon: Info },
]

interface Props {
  current: Page
  onChange: (p: Page) => void
}

export function Sidebar({ current, onChange }: Props) {
  return (
    <nav className="flex flex-col w-14 bg-zinc-900 border-r border-zinc-800 py-2 gap-0.5 shrink-0">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          title={label}
          onClick={() => onChange(id)}
          className={cn(
            'flex flex-col items-center justify-center h-12 w-full gap-0.5 text-[9px] font-medium transition-colors cursor-pointer',
            current === id
              ? 'text-white bg-zinc-700 rounded-sm mx-1 w-12'
              : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800',
          )}
        >
          <Icon size={17} strokeWidth={1.75} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
