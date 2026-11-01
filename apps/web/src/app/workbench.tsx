import { useQuery } from '@tanstack/react-query'
import {
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon,
} from 'lucide-react'
import { useEffect } from 'react'

import { sceneSchema } from '@pi-workbench/shared'
import { Badge } from '@pi-workbench/ui/components/badge'
import { Button } from '@pi-workbench/ui/components/button'

import { ChangesPanel } from '../features/changes/changes-panel.js'
import { Composer } from '../features/composer/composer.js'
import { getFixture, getHealth, LocalContractError } from '../services/api.js'
import { useWorkbench } from '../stores/workbench.js'
import { sceneNames } from './constants.js'
import { SceneContent } from './scene-content.js'

export function Workbench() {
  const scene = useWorkbench((state) => state.scene)
  const theme = useWorkbench((state) => state.theme)
  const navOpen = useWorkbench((state) => state.navOpen)
  const changesOpen = useWorkbench((state) => state.changesOpen)
  const setScene = useWorkbench((state) => state.setScene)
  const setTheme = useWorkbench((state) => state.setTheme)
  const toggleNav = useWorkbench((state) => state.toggleNav)
  const toggleChanges = useWorkbench((state) => state.toggleChanges)
  const applyFixture = useWorkbench((state) => state.applyFixture)
  const needsSync = useWorkbench((state) => state.projection.needsSync)
  const health = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false,
    refetchInterval: 5000,
  })
  const fixture = useQuery({
    queryKey: ['offline-scene', scene],
    queryFn: () => getFixture(scene),
    retry: false,
  })
  const connected = health.isSuccess && !fixture.isError && scene !== 'offline' && !needsSync
  useEffect(() => {
    if (fixture.data) {
      applyFixture(fixture.data)
    }
  }, [fixture.data, applyFixture])
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && system.matches),
      )
    apply()
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [theme])
  return (
    <div className="workbench-root">
      <div className="development-bar">
        <Badge variant="outline">OPS-01 离线基础壳</Badge>
        <span className="development-note">假内核样本，不调用提供商</span>
        <div className="development-controls">
          <label>
            <span className="sr-only">离线状态样本</span>
            <select
              aria-label="离线状态样本"
              value={scene}
              onChange={(event) => setScene(sceneSchema.parse(event.target.value))}
            >
              {Object.entries(sceneNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">主题</span>
            <select
              aria-label="主题"
              value={theme}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'light' || value === 'dark' || value === 'system') {
                  setTheme(value)
                }
              }}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      </div>
      <div
        className={`workspace ${navOpen ? 'nav-open' : ''} ${changesOpen ? 'review-layout' : ''}`}
      >
        <aside className="sidebar" aria-label="项目与会话">
          <div className="sidebar-brand">
            <span className="pi-mark">π</span>
            <strong>Pi Workbench</strong>
            <Button variant="ghost" size="icon-sm" aria-label="收起导航" onClick={toggleNav}>
              <PanelLeftIcon />
            </Button>
          </div>
          <nav className="sidebar-actions">
            <Button variant="ghost" onClick={() => setScene('new')}>
              <MessageSquarePlusIcon data-icon="inline-start" />
              新会话
            </Button>
            <Button variant="ghost" disabled title="SESSION-12 / M2 接入">
              <SearchIcon data-icon="inline-start" />
              搜索会话
            </Button>
          </nav>
          <div className="sidebar-list">
            <p className="sidebar-label">项目</p>
            <div className="project-label">
              <ChevronDownIcon />
              <FolderIcon />
              atlas-console
            </div>
            <Button variant="ghost" className="session-item" onClick={() => setScene('review')}>
              修复登录过期后的重复跳转
            </Button>
            <Button variant="ghost" className="session-item" onClick={() => setScene('approval')}>
              检查构建产物与依赖
              <Badge variant="outline">待审批</Badge>
            </Button>
            <p className="sidebar-label">最近 · 无项目</p>
            <Button variant="ghost" onClick={() => setScene('new')}>
              整理下周的开发计划
            </Button>
          </div>
          <div className="sidebar-footer">
            <Button variant="ghost" disabled title="完整设置按 M4 / M5 接入，上方可切换主题">
              <SettingsIcon data-icon="inline-start" />
              设置
            </Button>
            <span>本地工作台</span>
          </div>
        </aside>
        {navOpen ? (
          <button className="nav-scrim" aria-label="关闭导航遮罩" onClick={toggleNav} />
        ) : null}
        <main className="main-area">
          <header className="thread-header">
            <Button
              className="mobile-nav"
              variant="ghost"
              size="icon-sm"
              aria-label="展开导航"
              onClick={toggleNav}
            >
              <PanelLeftIcon />
            </Button>
            <div className="thread-identity">
              <strong>{scene === 'new' ? '新会话' : '修复登录过期后的重复跳转'}</strong>
              <span>
                {scene === 'new'
                  ? '无项目 · 独立执行目录'
                  : 'atlas-console / D:\\Projects\\atlas-console'}
              </span>
            </div>
            <div className="thread-actions">
              <Button variant="ghost" disabled>
                <TerminalIcon data-icon="inline-start" />
                终端
              </Button>
              <Button variant="ghost" disabled>
                <FileIcon data-icon="inline-start" />
                文件
              </Button>
              {scene === 'review' ? (
                <Button variant="ghost" aria-pressed={changesOpen} onClick={toggleChanges}>
                  变更 2
                </Button>
              ) : null}
            </div>
          </header>
          <div className="conversation-workspace">
            <div className="conversation-column">
              <SceneContent
                failed={fixture.isError || health.isError}
                invalidContract={
                  fixture.error instanceof LocalContractError ||
                  health.error instanceof LocalContractError
                }
                pending={fixture.isPending}
                reconnect={() => {
                  void health.refetch()
                  void fixture.refetch()
                }}
              />
              <Composer connected={connected} />
            </div>
            {changesOpen && scene === 'review' ? <ChangesPanel /> : null}
          </div>
          <footer className="status-bar">
            <span>
              <i className={connected ? 'connected-dot' : ''} />
              {connected ? '本地服务已连接' : '连接状态待确认'}
            </span>
            <span>
              {sceneNames[scene]}
              费用未知
            </span>
          </footer>
        </main>
      </div>
    </div>
  )
}
