import { LayoutDashboard, ScrollText, Settings, Info, Sun, Moon } from 'lucide-react'
import { useSettingsStore, type Theme, type Lang } from '@/stores/settings'
import { useT } from '@/lib/i18n'

export type Page = 'dashboard' | 'logs' | 'settings' | 'about'

interface Props {
  current: Page
  onChange: (p: Page) => void
}

export function Sidebar({ current, onChange }: Props) {
  const t = useT()
  const { theme, lang, setTheme, setLang } = useSettingsStore()

  const NAV: { id: Page; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'logs',      label: t.nav.logs,      icon: ScrollText },
    { id: 'settings',  label: t.nav.settings,  icon: Settings },
    { id: 'about',     label: t.nav.about,     icon: Info },
  ]

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  const toggleLang  = () => setLang(lang === 'en' ? 'zh' : 'en')

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

      {/* Bottom controls: theme + lang toggles */}
      <div
        style={{
          padding: '8px 6px 12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {/* Theme toggle: sun/moon */}
        <SidebarIconBtn
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          {theme === 'dark'
            ? <Sun  size={15} strokeWidth={1.75} />
            : <Moon size={15} strokeWidth={1.75} />}
        </SidebarIconBtn>

        {/* Language toggle: EN / 中 */}
        <SidebarIconBtn
          title={lang === 'en' ? '切换为中文' : 'Switch to English'}
          onClick={toggleLang}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1 }}>
            {lang === 'en' ? '中' : 'EN'}
          </span>
        </SidebarIconBtn>
      </div>
    </nav>
  )
}

function SidebarIconBtn({
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
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 30,
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: 'var(--c-text-3)',
        cursor: 'pointer',
        transition: 'color 130ms ease, background 130ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--c-text-2)'
        e.currentTarget.style.background = 'var(--c-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--c-text-3)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}
