import {
  LayoutDashboard,
  ScrollText,
  Settings,
  Info,
  Sun,
  Moon,
  Laptop,
  KeyRound,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { useRef } from 'react'
import appIconSmall from '@/assets/app-icon-small.png'

export type Page = 'dashboard' | 'logs' | 'authFiles' | 'settings' | 'about'

interface Props {
  current: Page
  onChange: (p: Page) => void
}

export function Sidebar({ current, onChange }: Props) {
  const t = useT()
  const { theme, lang, setTheme, setLang } = useSettingsStore()
  const navRefs = useRef<(HTMLButtonElement | null)[]>([])

  const NAV: { id: Page; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'logs', label: t.nav.logs, icon: ScrollText },
    { id: 'authFiles', label: t.nav.authFiles, icon: KeyRound },
    { id: 'settings', label: t.nav.settings, icon: Settings },
    { id: 'about', label: t.nav.about, icon: Info },
  ]

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next)
  }
  const toggleLang = () => setLang(lang === 'en' ? 'zh' : 'en')

  const themeIcon =
    theme === 'light' ? (
      <Sun size={15} strokeWidth={1.75} />
    ) : theme === 'dark' ? (
      <Moon size={15} strokeWidth={1.75} />
    ) : (
      <Laptop size={15} strokeWidth={1.75} />
    )
  const themeTitle =
    theme === 'light'
      ? 'Light theme — click for Dark'
      : theme === 'dark'
        ? 'Dark theme — click for System'
        : 'System theme — click for Light'

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
        <img
          src={appIconSmall}
          alt="CPA Desktop"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            display: 'block',
          }}
        />
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--c-border-sub)', margin: '0 10px' }} />

      {/* Nav items */}
      <div
        role="tablist"
        aria-orientation="vertical"
        style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const buttons = navRefs.current.filter((b): b is HTMLButtonElement => b !== null)
          const idx = buttons.findIndex((b) => b === document.activeElement)
          if (idx === -1) return
          const next =
            e.key === 'ArrowDown'
              ? (idx + 1) % buttons.length
              : (idx - 1 + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}
      >
        {NAV.map(({ id, label, icon: Icon }, index) => {
          const active = current === id
          return (
            <button
              key={id}
              ref={(el) => {
                navRefs.current[index] = el
              }}
              title={label}
              aria-label={label}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-nav-item
              onClick={() => onChange(id)}
              className="nav-item"
              data-active={active}
            >
              <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
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
        {/* Theme toggle: light → dark → system */}
        <SidebarIconBtn
          title={themeTitle}
          ariaLabel={`Switch to ${theme === 'light' ? 'Dark' : theme === 'dark' ? 'System' : 'Light'} Theme (Currently ${theme})`}
          onClick={toggleTheme}
        >
          {themeIcon}
        </SidebarIconBtn>

        {/* Language toggle: EN / 中 */}
        <SidebarIconBtn
          title={lang === 'en' ? '切换为中文' : 'Switch to English'}
          ariaLabel={
            lang === 'en'
              ? 'Switch to Chinese (Currently English)'
              : 'Switch to English (Currently Chinese)'
          }
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
  ariaLabel,
  onClick,
}: {
  children: React.ReactNode
  title: string
  ariaLabel?: string
  onClick: () => void
}) {
  return (
    <button
      title={title}
      aria-label={ariaLabel || title}
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
