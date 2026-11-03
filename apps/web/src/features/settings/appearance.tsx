import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'

import { desktopThemeSchema } from '@pi-workbench/shared'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@pi-workbench/ui/components/field'
import { Separator } from '@pi-workbench/ui/components/separator'

import { useWorkbench } from '../../stores/workbench.js'

export function AppearanceSettings() {
  const theme = useWorkbench((state) => state.theme)
  const setTheme = useWorkbench((state) => state.setTheme)
  return (
    <main className="settings-page">
      <header>
        <h1>外观</h1>
        <p>让工作台适合你的阅读习惯。</p>
      </header>
      <section aria-label="主题设置" className="settings-section">
        <h2>主题</h2>
        <FieldGroup>
          <Field orientation="responsive" className="settings-row">
            <FieldContent>
              <FieldLabel htmlFor="appearance-theme">颜色模式</FieldLabel>
              <FieldDescription>跟随系统，或选择你喜欢的明暗主题。</FieldDescription>
            </FieldContent>
            <select
              id="appearance-theme"
              aria-label="外观主题"
              className="settings-select"
              value={theme}
              onChange={(event) => setTheme(desktopThemeSchema.parse(event.target.value))}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </Field>
        </FieldGroup>
        <div className="theme-previews" aria-hidden="true">
          {[
            { id: 'light', label: '浅色', icon: SunIcon },
            { id: 'dark', label: '深色', icon: MoonIcon },
            { id: 'system', label: '跟随系统', icon: MonitorIcon },
          ].map(({ id, label, icon: Icon }) => (
            <div className="theme-preview" data-theme={id} data-selected={theme === id} key={id}>
              <div className="theme-preview-window">
                <div className="theme-preview-sidebar">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="theme-preview-body">
                  <i />
                  <i />
                  <div />
                </div>
              </div>
              <span>
                <Icon />
                {label}
              </span>
            </div>
          ))}
        </div>
        <output className="settings-hint">
          {theme === 'system'
            ? '正在跟随系统外观，系统主题变化时自动切换。'
            : `当前使用${theme === 'light' ? '浅色' : '深色'}主题。`}
        </output>
      </section>
      <Separator />
      <section aria-label="阅读与布局" className="settings-section">
        <h2>阅读与布局</h2>
        <div className="settings-row">
          <div>
            <strong>界面密度</strong>
            <p>为日常对话与展开审查保留合适的留白。</p>
          </div>
          <span>中等</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>文字大小</strong>
            <p>界面 14 px · 消息 15 px · 辅助信息 12 px</p>
          </div>
          <span>默认</span>
        </div>
      </section>
      {window.piWorkbench ? (
        <>
          <Separator />
          <section aria-label="桌面窗口" className="settings-section">
            <h2>桌面窗口</h2>
            <div className="settings-row">
              <div>
                <strong>关闭后保留在托盘</strong>
                <p>关闭窗口后可从系统托盘返回；在文件或托盘菜单中退出应用。</p>
              </div>
              <span>已启用</span>
            </div>
          </section>
        </>
      ) : null}
    </main>
  )
}
