import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { agentNames, agentTypes, type AgentCommand, type CommandCheck, type Settings } from '../shared/model';
import { defaultShortcuts, displayShortcut, shortcutActions, shortcutFromEvent, shortcutNames, shortcutConflicts, type ShortcutAction } from '../shared/shortcuts';
import type { ReportNotice } from './Notices';
import { agentIcons } from './agent-icons';

function AgentFields({ type, value, change, invalid }: { invalid: boolean; type: typeof agentTypes[number]; value: AgentCommand; change(value: AgentCommand): void }) {
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
    <input id={`command-${type}`} className="command-input" aria-invalid={invalid || undefined} aria-describedby={invalid ? `command-error-${type}` : undefined} value={value.command} spellCheck={false} onChange={event => {
      revision.current++; setCheck(undefined); setChecking(false); change({ ...value, command: event.target.value });
    }} />
    <div id={`command-error-${type}`} className="error-text" role={invalid ? "alert" : undefined}>{invalid ? '启动命令不能为空' : null}</div>
    <div className={`command-result ${check && !check.available ? 'error-text' : 'muted'}`} aria-live="polite">{check ? check.available ? `命令可用：${check.path}` : check.message : '\u00a0'}</div>
    <label htmlFor={`arguments-${type}`}>启动参数 <span className="muted">· 每行一个参数，无需添加引号</span></label>
    <textarea id={`arguments-${type}`} className="command-input" rows={2} value={value.args.join('\n')} spellCheck={false} onChange={event => change({ ...value, args: event.target.value ? event.target.value.split('\n') : [] })} />
  </section>;
}

const sections = ['agents', 'appearance', 'shortcuts'] as const;
type Section = typeof sections[number];
const sectionNames = { agents: 'Agent', appearance: '外观', shortcuts: '快捷键' };

export interface SettingsPageActions { requestLeave(): Promise<boolean> }

export function SettingsPage({ settings, startupTheme, back, ref, report }: { settings: Settings; startupTheme: Settings['theme']; back(): void; ref: Ref<SettingsPageActions>; report: ReportNotice }) {
  const [section, setSection] = useState<Section>('agents');
  const [agents, setAgents] = useState(settings.agents);
  const [theme, setTheme] = useState(settings.theme);
  const [defaultLayout, setDefaultLayout] = useState(settings.defaultLayout);
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<ShortcutAction>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [section]);
  const [leaveCategories, setLeaveCategories] = useState<Section[]>([]);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveDecision = useRef<(leave: boolean) => void>(undefined);
  const dirty = sections.filter(category => category === 'agents' ? JSON.stringify(agents) !== JSON.stringify(settings.agents)
    : category === 'appearance' ? theme !== settings.theme || defaultLayout !== settings.defaultLayout
    : JSON.stringify(shortcuts) !== JSON.stringify(settings.shortcuts));
  useImperativeHandle(ref, () => ({ async requestLeave() {
    if (pending.current || leaveDecision.current) return false;
    if (!dirty.length) return true;
    setLeaveCategories(dirty);
    return new Promise<boolean>(resolve => { leaveDecision.current = resolve; leaveDialog.current?.showModal(); });
  } }));
  useEffect(() => () => { leaveDecision.current?.(false); }, []);
  function decideLeave(leave: boolean) {
    leaveDialog.current?.close(); setLeaveCategories([]);
    const resolve = leaveDecision.current; leaveDecision.current = undefined; resolve?.(leave);
  }
  const defaults = defaultShortcuts();
  const conflicts = shortcutConflicts(shortcuts);
  const conflictColors = ['#bb493b', '#8960b4', '#33778f', '#927127', '#b14178', '#467944', '#5559b4', '#b56722'];
  function valid(category: Section) {
    if (category === 'shortcuts' && conflicts.length) {
      setSection('shortcuts'); setSearch(''); setError('存在按键冲突，未保存'); report('存在按键冲突，未保存');
      requestAnimationFrame(() => document.getElementById(`shortcut-${conflicts[0].actions[0]}`)?.scrollIntoView({ block: 'nearest' }));
      return false;
    }
    if (category === 'agents') {
      const invalid = agentTypes.find(type => !agents[type].command.trim());
      if (invalid) {
        setSection('agents'); setError('存在需修正的设置，未保存'); report('存在需修正的设置，未保存');
        requestAnimationFrame(() => { const input = document.getElementById(`command-${invalid}`); input?.scrollIntoView({ block: 'nearest' }); input?.focus(); });
        return false;
      }
    }
    return true;
  }
  async function save(category: Section, quiet = false): Promise<boolean> {
    if (pending.current || !valid(category)) return false;
    const patch = category === 'agents' ? { agents } : category === 'appearance' ? { theme, defaultLayout } : { shortcuts };
    pending.current = true; setSaving(true); setError('');
    try { await window.workbench.saveSettings(patch); if (!quiet) report(category === 'appearance' ? '配置已保存，主题重启后生效' : '配置已保存', 'success'); return true; }
    catch (error) {
      const detail = (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      const conflict = detail.includes('快捷键冲突');
      const message = conflict ? '存在按键冲突，未保存' : detail;
      setSection(conflict || detail.includes('快捷键无效') ? 'shortcuts' : category); setError(message); report(message);
      if (conflict) {
        setSearch('');
        const action = (conflicts[0] ?? shortcutConflicts(settings.shortcuts)[0])?.actions[0];
        requestAnimationFrame(() => document.getElementById(`shortcut-${action}`)?.scrollIntoView({ block: 'nearest' }));
      }
      return false;
    }
    finally { pending.current = false; setSaving(false); }
  }
  async function saveAndLeave() {
    leaveDialog.current?.close();
    const categories = [...leaveCategories].sort((first, second) => Number(second === 'shortcuts') - Number(first === 'shortcuts'));
    if (!categories.every(valid)) { decideLeave(false); return; }
    for (const category of categories) if (!await save(category, true)) { decideLeave(false); return; }
    report(categories.includes('appearance') ? '配置已保存，主题重启后生效' : '配置已保存', 'success'); decideLeave(true);
  }
  const query = search.trim().toLowerCase();
  const actions = shortcutActions.filter(action => `${shortcutNames[action]} ${shortcuts[action]} ${displayShortcut(shortcuts[action])}`.toLowerCase().includes(query));
  return <div className="settings-page">
    <div className="settings-shell"><button className="settings-back text-button" autoFocus disabled={saving} onClick={back}>‹ 返回</button>
      <h1>全局设置</h1><div className="settings-columns">
        <nav className="settings-navigation" aria-label="设置分类">{(['agents', 'appearance', 'shortcuts'] as const).map(tab => <button key={tab} aria-current={section === tab ? 'page' : undefined} onClick={() => { setSection(tab); setError(''); }}>{ { agents: 'Agent', appearance: '外观', shortcuts: '快捷键' }[tab]}</button>)}</nav>
        <div className="settings-content">
          <header className="settings-content-heading"><h2>{sectionNames[section]} 设置</h2><div className="settings-save">
            <span className="settings-status" aria-live="polite">{error ? <span className="error-text" role="alert">{error}</span> : saving ? '正在保存…' : ''}</span>
            <button className="primary" disabled={saving} onClick={() => void save(section)}>{ { agents: '保存 Agent 设置', appearance: '保存外观设置', shortcuts: '保存快捷键' }[section]}</button>
          </div></header>
          <div className="settings-scroll" ref={scroll}><fieldset disabled={saving}>
          {section === 'agents' && <form onSubmit={event => { event.preventDefault(); void save('agents'); }}>
            <p className="muted">所有项目共用这些启动设置。保存后仅影响之后启动的 Agent。</p>
            {agentTypes.map(type => <AgentFields key={type} type={type} value={agents[type]} invalid={!agents[type].command.trim()} change={value => setAgents(previous => ({ ...previous, [type]: value }))} />)}
          </form>}
          {section === 'appearance' && <form onSubmit={event => { event.preventDefault(); void save('appearance'); }}>
            <h2>主题</h2><p className="muted">工作台与终端在启动时统一应用主题。</p>
            <div className="theme-options" role="radiogroup" aria-label="主题">{(['system', 'dark', 'light'] as const).map(option => <label key={option}><input type="radio" name="theme" value={option} checked={theme === option} onChange={() => setTheme(option)} />{ { system: '跟随系统', dark: '深色', light: '浅色' }[option]}</label>)}</div>
            {settings.theme !== startupTheme && <p className="restart-notice" role="status">主题已保存，重启应用后生效。重启会结束所有正在运行的 Agent，请自行安排重启时间。</p>}
            <hr /><label htmlFor="default-layout">默认布局</label><select id="default-layout" value={defaultLayout} onChange={event => setDefaultLayout(event.target.value as Settings['defaultLayout'])}><option value="auto">自动排布</option><option value="row">横向平铺</option><option value="column">纵向平铺</option></select>
            <p className="muted">仅用于没有保存布局的初始安排，已有项目保留实际布局。</p>
          </form>}
          {section === 'shortcuts' && <>
            <p className="muted">选择右侧输入框，按下新的组合键；保存后立即生效。</p>
            <div className="shortcut-search"><input aria-label="搜索操作或快捷键" placeholder="搜索操作或快捷键" value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setRecording(undefined); setError(''); setShortcuts(defaults); }}>恢复全部默认</button><button onClick={() => { setRecording(undefined); setError(''); setShortcuts(settings.shortcuts); }}>放弃更改</button></div>
            <p className="muted">{actions.length} 项操作</p>
            {actions.map(action => {
              const groupIndex = conflicts.findIndex(group => group.actions.includes(action));
              const conflict = conflicts[groupIndex];
              return <div className={`shortcut-row ${conflict ? 'shortcut-conflict' : ''}`} style={conflict ? { '--conflict-color': conflictColors[groupIndex] } as CSSProperties : undefined} key={action}><div><label htmlFor={`shortcut-${action}`}>{shortcutNames[action]}</label><small>默认：{displayShortcut(defaults[action])}</small>{conflict && <p id={`conflict-${action}`} className="shortcut-conflict-message">冲突：{conflict.actions.filter(other => other !== action).map(other => shortcutNames[other]).concat(conflict.system ? [`系统「${conflict.system}」`] : []).join('、')}</p>}</div>
              <input id={`shortcut-${action}`} data-shortcut-recorder aria-invalid={!!conflict || undefined} aria-describedby={conflict ? `conflict-${action}` : undefined} title={shortcuts[action]} readOnly value={recording === action ? '按下组合键…' : displayShortcut(shortcuts[action])}
                onFocus={() => setRecording(action)} onBlur={() => setRecording(undefined)} onKeyDown={event => {
                  if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
                  event.preventDefault(); event.stopPropagation();
                  if (event.key === 'Escape') { setRecording(undefined); event.currentTarget.blur(); return; }
                  if (event.repeat) return;
                  const binding = shortcutFromEvent(event.nativeEvent);
                  if (!binding) return;
                  setShortcuts(previous => ({ ...previous, [action]: binding }));
                  setRecording(undefined); event.currentTarget.blur();
                }} />
            </div>; })}
            <p className="muted shortcut-help">仅在应用前台生效。Esc 取消录入；未处理输入继续交给选中 CLI。复制、粘贴等系统操作保留原绑定。</p>
          </>}
        </fieldset></div>
        </div>
      </div>
    </div>
    <dialog ref={leaveDialog} className="settings-leave" onCancel={event => { event.preventDefault(); decideLeave(false); }}>
      <h2>保存设置更改？</h2><p>以下分类有未保存的更改：{leaveCategories.map(category => sectionNames[category]).join('、')}</p>
      <div className="dialog-actions"><button onClick={() => decideLeave(false)}>取消</button><button onClick={() => decideLeave(true)}>不保存</button><button className="primary" onClick={() => void saveAndLeave()}>保存并返回</button></div>
    </dialog>
  </div>;
}
