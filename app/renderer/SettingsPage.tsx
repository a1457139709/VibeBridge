import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { agentNames, agentTypes, type AgentCommand, type CommandCheck, type Settings } from '../shared/model';
import { defaultShortcuts, displayShortcut, shortcutActions, shortcutFromEvent, shortcutNames, validateShortcuts, type ShortcutAction } from '../shared/shortcuts';
import type { ReportNotice } from './Notices';
import { agentIcons } from './agent-icons';

function AgentFields({ type, value, change }: { type: typeof agentTypes[number]; value: AgentCommand; change(value: AgentCommand): void }) {
  const [check, setCheck] = useState<CommandCheck>();
  const [checking, setChecking] = useState(false);
  const revision = useRef(0);
  async function checkCommand() {
    const request = ++revision.current;
    setChecking(true); setCheck(undefined);
    try {
      const result = await window.workbench.checkCommand(value.command);
      if (request === revision.current) setCheck(result);
    } catch (error) {
      if (request === revision.current) setCheck({ available: false, message: (error as Error).message });
    } finally { if (request === revision.current) setChecking(false); }
  }
  return <section className={`agent-settings ${type}`}>
    <div className="settings-row-heading"><h2><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</h2><button type="button" disabled={checking || !value.command.trim()} onClick={() => void checkCommand()}>{checking ? '检查中…' : '检查命令'}</button></div>
    <label htmlFor={`command-${type}`}>启动命令</label>
    <input id={`command-${type}`} className="command-input" value={value.command} spellCheck={false} onChange={event => {
      revision.current++; setCheck(undefined); setChecking(false); change({ ...value, command: event.target.value });
    }} />
    <div className={`command-result ${check && !check.available ? 'error-text' : 'muted'}`} aria-live="polite">{check ? check.available ? `命令可用：${check.path}` : check.message : '\u00a0'}</div>
    <label htmlFor={`arguments-${type}`}>启动参数 <span className="muted">· 每行一个参数，无需添加引号</span></label>
    <textarea id={`arguments-${type}`} className="command-input" rows={2} value={value.args.join('\n')} spellCheck={false} onChange={event => change({ ...value, args: event.target.value ? event.target.value.split('\n') : [] })} />
  </section>;
}

export interface SettingsPageActions { requestLeave(): Promise<boolean> }

export function SettingsPage({ settings, startupTheme, back, ref, report }: { settings: Settings; startupTheme: Settings['theme']; back(): void; ref: Ref<SettingsPageActions>; report: ReportNotice }) {
  const [section, setSection] = useState<'agents' | 'appearance' | 'shortcuts'>('agents');
  const [agents, setAgents] = useState(settings.agents);
  const [theme, setTheme] = useState(settings.theme);
  const [defaultLayout, setDefaultLayout] = useState(settings.defaultLayout);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<ShortcutAction>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useImperativeHandle(ref, () => ({ async requestLeave() { return !pending.current; } }));
  const defaults = defaultShortcuts();
  async function save(patch: Partial<Settings>) {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try { await window.workbench.saveSettings(patch); report(patch.theme ? '配置已保存，主题重启后生效' : '配置已保存', 'success'); }
    catch (error) { report((error as Error).message); }
    finally { pending.current = false; setSaving(false); }
  }
  const query = search.trim().toLowerCase();
  const actions = shortcutActions.filter(action => `${shortcutNames[action]} ${settings.shortcuts[action]} ${displayShortcut(settings.shortcuts[action])}`.toLowerCase().includes(query));
  return <div className="settings-page">
    <div className="settings-shell"><button className="settings-back text-button" autoFocus disabled={saving} onClick={back}>‹ 返回</button>
      <h1>全局设置</h1><div className="settings-columns">
        <nav className="settings-navigation" aria-label="设置分类">{(['agents', 'appearance', 'shortcuts'] as const).map(tab => <button key={tab} aria-current={section === tab ? 'page' : undefined} onClick={() => { setSection(tab); setError(''); }}>{ { agents: 'Agent', appearance: '外观', shortcuts: '快捷键' }[tab]}</button>)}</nav>
        <div className="settings-content"><fieldset disabled={saving}>
          {section === 'agents' && <form onSubmit={event => { event.preventDefault(); void save({ agents }); }}>
            <p className="muted">所有项目共用这些启动设置。保存后仅影响之后启动的 Agent。</p>
            {agentTypes.map(type => <AgentFields key={type} type={type} value={agents[type]} change={value => setAgents(previous => ({ ...previous, [type]: value }))} />)}
            <button className="primary" type="submit">保存 Agent 设置</button>
          </form>}
          {section === 'appearance' && <form onSubmit={event => { event.preventDefault(); void save({ theme, defaultLayout }); }}>
            <h2>主题</h2><p className="muted">工作台与终端在启动时统一应用主题。</p>
            <div className="theme-options" role="radiogroup" aria-label="主题">{(['system', 'dark', 'light'] as const).map(option => <label key={option}><input type="radio" name="theme" value={option} checked={theme === option} onChange={() => setTheme(option)} />{ { system: '跟随系统', dark: '深色', light: '浅色' }[option]}</label>)}</div>
            {settings.theme !== startupTheme && <p className="restart-notice" role="status">主题已保存，重启应用后生效。重启会结束所有正在运行的 Agent，请自行安排重启时间。</p>}
            <hr /><label htmlFor="default-layout">默认布局</label><select id="default-layout" value={defaultLayout} onChange={event => setDefaultLayout(event.target.value as Settings['defaultLayout'])}><option value="auto">自动排布</option><option value="row">横向平铺</option><option value="column">纵向平铺</option></select>
            <p className="muted">仅用于没有保存布局的初始安排，已有项目保留实际布局。</p>
            <button className="primary" type="submit">保存外观设置</button>
          </form>}
          {section === 'shortcuts' && <>
            <p className="muted">选择右侧输入框，按下新的组合键；保存后立即生效。</p>
            <div className="shortcut-search"><input aria-label="搜索操作或快捷键" placeholder="搜索操作或快捷键" value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setRecording(undefined); void save({ shortcuts: defaults }); }}>恢复全部默认</button></div>
            <p className="muted">{actions.length} 项操作</p>
            {actions.map(action => <div className="shortcut-row" key={action}><div><label htmlFor={`shortcut-${action}`}>{shortcutNames[action]}</label><small>默认：{displayShortcut(defaults[action])}</small></div>
              <input id={`shortcut-${action}`} data-shortcut-recorder title={settings.shortcuts[action]} readOnly value={recording === action ? '按下组合键…' : displayShortcut(settings.shortcuts[action])}
                onFocus={() => setRecording(action)} onBlur={() => setRecording(undefined)} onKeyDown={event => {
                  if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
                  event.preventDefault(); event.stopPropagation();
                  if (event.key === 'Escape') { setRecording(undefined); event.currentTarget.blur(); return; }
                  if (event.repeat) return;
                  const binding = shortcutFromEvent(event.nativeEvent);
                  if (!binding) return;
                  const shortcuts = { ...settings.shortcuts, [action]: binding };
                  try { validateShortcuts(shortcuts); }
                  catch (error) { setError((error as Error).message); setRecording(undefined); event.currentTarget.blur(); return; }
                  setRecording(undefined); event.currentTarget.blur(); void save({ shortcuts });
                }} />
            </div>)}
            <p className="muted shortcut-help">仅在应用前台生效。Esc 取消录入；未处理输入继续交给选中 CLI。复制、粘贴等系统操作保留原绑定。</p>
          </>}
        </fieldset>
          <div className="settings-status" aria-live="polite">{error ? <span className="error-text" role="alert">{error}</span> : saving ? '正在保存…' : ''}</div>
        </div>
      </div>
    </div>
  </div>;
}
