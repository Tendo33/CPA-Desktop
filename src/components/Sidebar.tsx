import { LayoutDashboard, ScrollText, Settings, Info } from 'lucide-react'

export type Page = 'dashboard' | 'logs' | 'settings' | 'about'

const NAV: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'logs',      label: 'Logs',      icon: ScrollText },
  { id: 'settings',  label: 'Settings',  icon: Settings },
  { id: 'about',     label: 'About',     icon: Info },
]

interface Props {
  current: Page
  onChange: (p: Page) => void
}

export function Sidebar({ current, onChange }: Props) {
  return (
    <nav
      style={{
        width: 52,
        background: 'var(--c-surface)',
        borderRight: '1px solid var(--c-border-sub)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Logotype */}
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: 'var(--c-accent)',
            lineHeight: 1,
          }}
        >
          CPA
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--c-border-sub)', margin: '0 10px' }} />

      {/* Nav items */}
      <div style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = current === id
          return (
            <button
              key={id}
              title={label}
              onClick={() => onChange(id)}
              className="nav-item"
              data-active={active}
            >
              <Icon
                size={16}
                strokeWidth={active ? 2.25 : 1.75}
              />
            </button>
          )
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom decoration — tiny version hint */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--c-border)',
          }}
        />
      </div>
    </nav>
  )
}
