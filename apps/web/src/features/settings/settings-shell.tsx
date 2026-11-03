import type { ReactNode } from 'react'

import {
  ArrowLeftIcon,
  BlocksIcon,
  KeyRoundIcon,
  MonitorIcon,
  PaletteIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, buttonVariants } from '@pi-workbench/ui/components/button'
import { Field, FieldLabel } from '@pi-workbench/ui/components/field'
import { Input } from '@pi-workbench/ui/components/input'

import { useNavigation } from '../../services/navigation.js'

const sections = [
  {
    id: 'appearance',
    label: '外观',
    group: '工作台',
    href: '/?settings=appearance',
    icon: PaletteIcon,
    keywords: '主题 浅色 深色 跟随系统',
  },
  {
    id: 'models',
    label: '模型与提供商',
    group: '模型与连接',
    href: '/?models',
    icon: BlocksIcon,
    keywords: 'pi 模型 配置 来源',
  },
  {
    id: 'credentials',
    label: '凭证与隐私',
    group: '模型与连接',
    href: '/?credentials',
    icon: KeyRoundIcon,
    keywords: '认证 密钥 脱敏',
  },
  {
    id: 'clients',
    label: '已连接的客户端',
    group: '模型与连接',
    href: '/?clients',
    icon: MonitorIcon,
    keywords: '配对 浏览器 撤销',
  },
  {
    id: 'trust',
    label: '资源信任',
    group: '安全与运行',
    href: '/?trust',
    icon: ShieldCheckIcon,
    keywords: '项目 权限 资源',
  },
  {
    id: 'resources',
    label: '资源状态',
    group: '安全与运行',
    href: '/?resources',
    icon: SlidersHorizontalIcon,
    keywords: '内核 队列 限额 诊断',
  },
] as const
export type SettingsSection = (typeof sections)[number]['id']

/** A common layout for existing settings, without prefetching private pages. Navigation is
 * ordinary links; narrow windows keep the selected category reachable in a scrolling row.
 */
export function SettingsShell({
  section,
  children,
}: {
  section: SettingsSection
  children: ReactNode
}) {
  const { workbenchHref } = useNavigation()
  const [search, setSearch] = useState('')
  const content = useRef<HTMLElement>(null)
  const selected = useRef<HTMLAnchorElement>(null)
  const term = search.trim().toLowerCase()
  const visible = sections.filter(
    (item) =>
      (!term || `${item.label} ${item.keywords}`.toLowerCase().includes(term)) &&
      (item.id !== 'models' || Boolean(window.piWorkbench)),
  )
  useEffect(() => {
    content.current?.scrollTo(0, 0)
    const heading = content.current?.querySelector('h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    selected.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [section])
  return (
    <div className="settings-layout">
      <aside className="settings-sidebar" aria-label="设置分类">
        <div className="settings-sidebar-heading">
          <strong>设置</strong>
          <a
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            href={workbenchHref}
            aria-label="返回工作台"
            title="返回工作台"
          >
            <ArrowLeftIcon />
          </a>
        </div>
        <Field className="settings-search">
          <FieldLabel className="sr-only" htmlFor="settings-search">
            搜索设置
          </FieldLabel>
          <Input
            id="settings-search"
            type="search"
            placeholder="搜索设置…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <nav className="settings-navigation" aria-label="设置导航">
          {['工作台', '模型与连接', '安全与运行'].map((group) => {
            const items = visible.filter((item) => item.group === group)
            return items.length ? (
              <div className="settings-nav-group" key={group}>
                <p>{group}</p>
                {items.map(({ id, label, href, icon: Icon }) => (
                  <a
                    key={id}
                    href={href}
                    className="settings-nav-link"
                    aria-current={id === section ? 'page' : undefined}
                    ref={id === section ? selected : undefined}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </a>
                ))}
              </div>
            ) : null
          })}
          {!visible.length ? (
            <div className="settings-search-empty">
              <output>没有匹配的设置</output>
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                清除搜索
              </Button>
            </div>
          ) : null}
        </nav>
        <div className="settings-sidebar-footer">
          <span className="pi-mark">π</span>
          <div>
            <strong>Pi Workbench</strong>
            <p>本地优先 · 离线发现</p>
          </div>
        </div>
      </aside>
      <section className="settings-content" aria-label="设置内容" ref={content} key={section}>
        {children}
      </section>
    </div>
  )
}
