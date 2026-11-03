import type { ReactNode } from 'react'

import { ArrowLeftIcon, ArrowRightIcon, HouseIcon, SettingsIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { desktopPageSchema } from '@pi-workbench/shared'
import { Button, buttonVariants } from '@pi-workbench/ui/components/button'

import {
  handleAppNavigation,
  navigate,
  useNavigation,
  workbenchHref,
} from '../services/navigation.js'
import { applyTheme } from '../services/theme.js'
import { useWorkbench } from '../stores/workbench.js'

/** Shared chrome owns theme synchronization and its fixed desktop subscriptions. Window
 * buttons remain native; all clickable title-bar regions explicitly exclude dragging.
 */
export function AppFrame({ children, settings }: { children: ReactNode; settings: boolean }) {
  const theme = useWorkbench((state) => state.theme)
  const navigation = useNavigation()
  const previousSearch = useRef(navigation.search)
  const [chromeError, setChromeError] = useState('')
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyTheme(theme)
    apply()
    media.addEventListener('change', apply)
    let current = true
    void window.piWorkbench
      ?.setTheme(theme)
      .then((accepted) => {
        if (current) {
          setChromeError(accepted ? '' : '窗口主题同步失败，请重新打开应用。')
        }
        return undefined
      })
      .catch(() => {
        if (current) {
          setChromeError('窗口主题同步失败，请重新打开应用。')
        }
      })
    return () => {
      current = false
      media.removeEventListener('change', apply)
    }
  }, [theme])
  useEffect(() => {
    document.addEventListener('click', handleAppNavigation)
    return () => document.removeEventListener('click', handleAppNavigation)
  }, [])
  useEffect(() => {
    if (previousSearch.current && !navigation.search) {
      const trigger = document.querySelector<HTMLElement>('[data-settings-trigger]')
      const target = trigger?.getClientRects().length
        ? trigger
        : document.querySelector<HTMLElement>('.mobile-nav')
      target?.focus({ preventScroll: true })
    }
    previousSearch.current = navigation.search
  }, [navigation.search])
  useEffect(
    () =>
      window.piWorkbench?.onNavigate((value) => {
        const page = desktopPageSchema.safeParse(value)
        if (page.success) {
          navigate(
            page.data === 'workbench'
              ? workbenchHref()
              : page.data === 'settings'
                ? '/?settings=appearance'
                : `/?${page.data}`,
          )
        }
      }),
    [],
  )
  return (
    <div className="app-frame" data-desktop={Boolean(window.piWorkbench)}>
      {window.piWorkbench ? (
        <header className="desktop-titlebar" aria-label="桌面控制栏">
          <div className="desktop-titlebar-content">
            <div className="desktop-history">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="后退"
                disabled={!navigation.canGoBack}
                onClick={() => history.back()}
              >
                <ArrowLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="前进"
                disabled={!navigation.canGoForward}
                onClick={() => history.forward()}
              >
                <ArrowRightIcon />
              </Button>
            </div>
            <nav className="desktop-menus" aria-label="应用菜单">
              {(
                [
                  { id: 'workbench', label: '文件' },
                  { id: 'edit', label: '编辑' },
                  { id: 'view', label: '视图' },
                  { id: 'help', label: '帮助' },
                ] as const
              ).map(({ id, label }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  aria-haspopup="menu"
                  onClick={() => {
                    void window.piWorkbench
                      ?.openMenu(id)
                      .then((opened) => {
                        setChromeError(opened ? '' : '菜单暂不可用，请使用侧栏入口。')
                        return undefined
                      })
                      .catch(() => setChromeError('菜单暂不可用，请使用侧栏入口。'))
                  }}
                >
                  {label}
                </Button>
              ))}
            </nav>
            <span className="desktop-title">Pi Workbench</span>
          </div>
        </header>
      ) : null}
      {chromeError ? <output className="chrome-error">{chromeError}</output> : null}
      <div className="app-body">
        {window.piWorkbench ? (
          <nav className="activity-rail" aria-label="工作台导航">
            <a
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              href={navigation.workbenchHref}
              aria-label="打开工作台"
              aria-current={!settings ? 'page' : undefined}
              title="工作台"
            >
              <HouseIcon />
            </a>
            <a
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              href="/?settings=appearance"
              aria-label="打开设置"
              aria-current={settings ? 'page' : undefined}
              title="设置"
            >
              <SettingsIcon />
            </a>
          </nav>
        ) : null}
        <div className="app-surface">{children}</div>
      </div>
    </div>
  )
}
