import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { agentNames, agentTypes, type AgentCommand, type CommandCheck, type Settings } from '../shared/model';
import { defaultShortcuts, displayShortcut, shortcutActions, shortcutFromEvent, shortcutNames, shortcutConflicts, type ShortcutAction } from '../shared/shortcuts';
import type { ReportNotice } from './Notices';
import { agentIcons } from './agent-icons';
import { defaultSettings, dirtySettingsCategories, settingsCategories, settingsIssues, settingsPatch, type SettingsCategory, type SettingsIssue } from '../shared/settings';

function AgentFields({ type, value, change, error, argsError }: { error?: string; argsError?: string; type: typeof agentTypes[number]; value: AgentCommand; change(value: AgentCommand): void }) {
  const [check, setCheck] = useState<CommandCheck>();
  const [checking, setChecking] = useState(false);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
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
    <input id={`command-${type}`} data-settings-field={`agents.${type}.command`} className="command-input" aria-invalid={!!error || undefined} aria-describedby={error ? `command-error-${type}` : undefined} value={value.command} spellCheck={false} onChange={event => {
      revision.current++; setCheck(undefined); setChecking(false); change({ ...value, command: event.target.value });
    }} />
    <div id={`command-error-${type}`} className="error-text" role={error ? 'alert' : undefined}>{error}</div>
    <div className={`command-result ${check && !check.available ? 'error-text' : 'muted'}`} aria-live="polite">{check ? check.available ? `命令可用：${check.path}` : check.message : null}</div>
    <label htmlFor={`arguments-${type}`}>启动参数 <span className="muted">· 每行一个参数，无需添加引号</span></label>
    <textarea id={`arguments-${type}`} data-settings-field={`agents.${type}.args`} aria-invalid={!!argsError || undefined} aria-describedby={argsError ? `arguments-error-${type}` : undefined} className="command-input" rows={2} value={value.args.join('\n')} spellCheck={false} onChange={event => change({ ...value, args: event.target.value ? event.target.value.split('\n') : [] })} />
    {argsError && <p id={`arguments-error-${type}`} className="error-text" role="alert">{argsError}</p>}
  </section>;
}

export interface SettingsPageActions { requestLeave(): Promise<boolean>; showCategory(category: SettingsCategory): void }

export function SettingsPage({ settings, startupTheme, initialCategory = settingsCategories[0].id, back, ref, report }: { settings: Settings; startupTheme: Settings['theme']; initialCategory?: SettingsCategory; back(): void; ref: Ref<SettingsPageActions>; report: ReportNotice }) {
  const [section, setSection] = useState<SettingsCategory>(initialCategory);
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(settings);
  useEffect(() => setSaved(settings), [settings]);
  const { agents, theme, defaultLayout, shortcuts } = draft;
  const [submittedIssues, setSubmittedIssues] = useState<SettingsIssue[]>([]);
  const issues = [...submittedIssues, ...settingsIssues(draft)];
  const fieldError = (field: string) => issues.find(issue => issue.field === field)?.message;
  function changeDraft(patch: Partial<Settings>) {
    setDraft(previous => ({ ...previous, ...patch }));
    setSubmittedIssues(previous => previous.filter(issue => !(issue.field.split('.')[0] in patch)));
  }
  const [agentRevision, setAgentRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<ShortcutAction>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [problemToFocus, setProblemToFocus] = useState<SettingsIssue>();
  const pending = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [section]);
  useLayoutEffect(() => {
    if (saving || !problemToFocus) return;
    const input = document.querySelector<HTMLElement>(`[data-settings-field="${CSS.escape(problemToFocus.field)}"]`);
    input?.scrollIntoView({ block: 'nearest' }); input?.focus();
    setProblemToFocus(undefined);
  }, [saving, problemToFocus]);
  const [leaveCategories, setLeaveCategories] = useState<SettingsCategory[]>([]);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveDecision = useRef<(leave: boolean) => void>(undefined);
  const dirty = dirtySettingsCategories(draft, saved);
  useImperativeHandle(ref, () => ({ async requestLeave() {
    if (pending.current || leaveDecision.current) return false;
    if (!dirty.length) return true;
    setLeaveCategories(dirty);
    return new Promise<boolean>(resolve => { leaveDecision.current = resolve; leaveDialog.current?.showModal(); });
  }, showCategory(category) { if (!pending.current && !leaveDecision.current) { setSection(category); setSearch(''); } } }));
  useEffect(() => () => { leaveDecision.current?.(false); }, []);
  function decideLeave(leave: boolean) {
    leaveDialog.current?.close(); setLeaveCategories([]);
    const resolve = leaveDecision.current; leaveDecision.current = undefined; resolve?.(leave);
  }
  const defaults = defaultShortcuts();
  function replaceDraft(values: Settings) {
    setError('');
    changeDraft(settingsPatch(values, [section]));
    setAgentRevision(value => value + 1); setRecording(undefined);
  }
  const conflicts = shortcutConflicts(shortcuts);
  const conflictColors = ['#bb493b', '#8960b4', '#33778f', '#927127', '#b14178', '#467944', '#5559b4', '#b56722'];
  async function save(categories: readonly SettingsCategory[]): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setSaving(true); setError('');
    try {
      const patch = settingsPatch(draft, categories);
      const result = await window.workbench.saveSettings(patch);
      if (result.ok) {
        setSaved(result.settings); setSubmittedIssues([]);
        report('theme' in patch ? '配置已保存，主题重启后生效' : '配置已保存', 'success');
        return true;
      }
      let message: string;
      if (result.kind === 'validation') {
        setSubmittedIssues(result.issues);
        const first = settingsCategories.flatMap(category => result.issues.filter(issue => issue.category === category.id))[0];
        message = first?.code === 'conflict' ? '存在按键冲突，未保存' : '存在需修正的设置，未保存';
        if (first) {
          setSection(first.category); setSearch(''); setProblemToFocus(first);
        }
      } else message = result.message;
      setError(message); report(message);
      return false;
    }
    finally { pending.current = false; setSaving(false); }
  }
  async function saveAndLeave() {
    leaveDialog.current?.close();
    decideLeave(await save(leaveCategories));
  }
  const query = search.trim().toLowerCase();
  const actions = shortcutActions.filter(action => `${shortcutNames[action]} ${shortcuts[action]} ${displayShortcut(shortcuts[action])}`.toLowerCase().includes(query));
  return <div className="settings-page">
    <div className="settings-shell"><button className="settings-back text-button" autoFocus disabled={saving} onClick={back}>‹ 返回</button>
      <h1>全局设置</h1><div className="settings-columns">
        <nav className="settings-navigation" aria-label="设置分类">{settingsCategories.map(category => <button key={category.id} disabled={saving} aria-current={section === category.id ? 'page' : undefined} onClick={() => { setSection(category.id); setError(''); }}>{category.name}</button>)}</nav>
        <div className="settings-content">
          <header className="settings-content-heading"><h2>{settingsCategories.find(category => category.id === section)?.name} 设置</h2><div className="settings-save">
            <span className="settings-status" aria-live="polite">{error ? <span className="error-text" role="alert">{error}</span> : saving ? '正在保存…' : ''}</span>
            <button disabled={saving} onClick={() => replaceDraft(defaultSettings())}>恢复默认设置</button>
            <button disabled={saving} onClick={() => replaceDraft(saved)}>放弃更改</button>
            <button className="primary" disabled={saving} onClick={() => void save([section])}>保存</button>
          </div></header>
          <div className="settings-scroll" ref={scroll}><fieldset disabled={saving}>
          {section === 'agents' && <form onSubmit={event => { event.preventDefault(); void save([section]); }}>
            <p className="muted">所有项目共用这些启动设置。保存后仅影响之后启动的 Agent。</p>
            {agentTypes.map(type => <AgentFields key={`${type}-${agentRevision}`} type={type} value={agents[type]} error={fieldError(`agents.${type}.command`)} argsError={fieldError(`agents.${type}.args`)} change={value => changeDraft({ agents: { ...agents, [type]: value } })} />)}
          </form>}
          {section === 'appearance' && <form onSubmit={event => { event.preventDefault(); void save([section]); }}>
            <h2>主题</h2><p className="muted">工作台与终端在启动时统一应用主题。</p>
            <div className="theme-options" role="radiogroup" aria-label="主题" data-settings-field="theme" tabIndex={-1} aria-invalid={!!fieldError('theme') || undefined} aria-describedby={fieldError('theme') ? 'theme-error' : undefined}>{(['system', 'dark', 'light'] as const).map(option => <label key={option}><input type="radio" name="theme" value={option} checked={theme === option} onChange={() => changeDraft({ theme: option })} />{ { system: '跟随系统', dark: '深色', light: '浅色' }[option]}</label>)}</div>
            {fieldError('theme') && <p id="theme-error" className="error-text" role="alert">{fieldError('theme')}</p>}
            {settings.theme !== startupTheme && <p className="restart-notice" role="status">主题已保存，重启应用后生效。重启会结束所有正在运行的 Agent，请自行安排重启时间。</p>}
            <hr /><label htmlFor="default-layout">默认布局</label><select id="default-layout" data-settings-field="defaultLayout" aria-invalid={!!fieldError('defaultLayout') || undefined} aria-describedby={fieldError('defaultLayout') ? 'layout-error' : undefined} value={defaultLayout} onChange={event => changeDraft({ defaultLayout: event.target.value as Settings['defaultLayout'] })}><option value="auto">自动排布</option><option value="row">横向平铺</option><option value="column">纵向平铺</option></select>
            {fieldError('defaultLayout') && <p id="layout-error" className="error-text" role="alert">{fieldError('defaultLayout')}</p>}
            <p className="muted">仅用于没有保存布局的初始安排，已有项目保留实际布局。</p>
          </form>}
          {section === 'shortcuts' && <>
            <p className="muted">选择右侧输入框，按下新的组合键；保存后立即生效。</p>
            <div className="shortcut-search"><input aria-label="搜索操作或快捷键" placeholder="搜索操作或快捷键" value={search} onChange={event => setSearch(event.target.value)} /></div>
            <p className="muted">{actions.length} 项操作</p>
            {actions.map(action => {
              const groupIndex = conflicts.findIndex(group => group.actions.includes(action));
              const conflict = conflicts[groupIndex];
              const issue = fieldError(`shortcuts.${action}`);
              return <div className={`shortcut-row ${conflict ? 'shortcut-conflict' : ''}`} style={conflict ? { '--conflict-color': conflictColors[groupIndex] } as CSSProperties : undefined} key={action}><div><label htmlFor={`shortcut-${action}`}>{shortcutNames[action]}</label><small>默认：{displayShortcut(defaults[action])}</small>{issue && <p id={`conflict-${action}`} className="shortcut-conflict-message error-text">{issue}</p>}</div>
              <input id={`shortcut-${action}`} data-settings-field={`shortcuts.${action}`} data-shortcut-recorder aria-invalid={!!issue || undefined} aria-describedby={issue ? `conflict-${action}` : undefined} title={shortcuts[action]} readOnly value={recording === action ? '按下组合键…' : displayShortcut(shortcuts[action])}
                onFocus={() => setRecording(action)} onBlur={() => setRecording(undefined)} onKeyDown={event => {
                  if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
                  event.preventDefault(); event.stopPropagation();
                  if (event.key === 'Escape') { setRecording(undefined); event.currentTarget.blur(); return; }
                  if (event.repeat) return;
                  const binding = shortcutFromEvent(event.nativeEvent);
                  if (!binding) return;
                  changeDraft({ shortcuts: { ...shortcuts, [action]: binding } });
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
      <h2>保存设置更改？</h2><p>以下分类有未保存的更改：{settingsCategories.filter(category => leaveCategories.includes(category.id)).map(category => category.name).join('、')}</p>
      <div className="dialog-actions"><button onClick={() => decideLeave(false)}>取消</button><button onClick={() => decideLeave(true)}>不保存</button><button className="primary" onClick={() => void saveAndLeave()}>保存并返回</button></div>
    </dialog>
  </div>;
}
