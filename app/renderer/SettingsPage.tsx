import { Localization, useLocalization } from './Localization';
import { localize } from '../shared/localization';
import { message } from '../shared/messages';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { agentNames, agentTypes, type AgentCommand, type CommandCheck, type Settings } from '../shared/model';
import { defaultShortcuts, displayShortcut, shortcutActions, shortcutFromEvent, shortcutConflicts, type ShortcutAction } from '../shared/shortcuts';
import type { ReportNotice } from './Notices';
import { agentIcons } from './agent-icons';
import { defaultSettings, dirtySettingsCategories, settingsCategories, settingsIssues, settingsPatch, type SettingsCategory, type SettingsIssue } from '../shared/settings';

function AgentFields({ type, value, change, error, argsError }: { error?: string; argsError?: string; type: typeof agentTypes[number]; value: AgentCommand; change(value: AgentCommand): void }) {
  const { t, text } = useLocalization();
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
    <div className="settings-row-heading"><h2><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</h2><button type="button" disabled={checking || !value.command.trim()} onClick={() => void checkCommand()}>{checking ? t('checkingCommand') : t('checkCommand')}</button></div>
    <label htmlFor={`command-${type}`}>{t('launchCommand')}</label>
    <input id={`command-${type}`} data-settings-field={`agents.${type}.command`} className="command-input" aria-invalid={!!error || undefined} aria-describedby={error ? `command-error-${type}` : undefined} value={value.command} spellCheck={false} onChange={event => {
      revision.current++; setCheck(undefined); setChecking(false); change({ ...value, command: event.target.value });
    }} />
    <div id={`command-error-${type}`} className="error-text" role={error ? 'alert' : undefined}>{error}</div>
    <div className={`command-result ${check && !check.available ? 'error-text' : 'muted'}`} aria-live="polite">{check ? check.available ? t('commandAvailable', { path: check.path }) : text(check.message) : null}</div>
    <label htmlFor={`arguments-${type}`}>{t('launchArguments')} <span className="muted">{t('argumentsHelp')}</span></label>
    <textarea id={`arguments-${type}`} data-settings-field={`agents.${type}.args`} aria-invalid={!!argsError || undefined} aria-describedby={argsError ? `arguments-error-${type}` : undefined} className="command-input" rows={2} value={value.args.join('\n')} spellCheck={false} onChange={event => change({ ...value, args: event.target.value ? event.target.value.split('\n') : [] })} />
    {argsError && <p id={`arguments-error-${type}`} className="error-text" role="alert">{argsError}</p>}
  </section>;
}

export interface SettingsPageActions { requestLeave(): Promise<boolean>; showCategory(category: SettingsCategory): void }

function SettingsEditor({ settings, defaultShortcutConflict, startupTheme, initialCategory = settingsCategories[0].id, back, ref, report }: { settings: Settings; defaultShortcutConflict: boolean; startupTheme: Settings['theme']; initialCategory?: SettingsCategory; back(): void; ref: Ref<SettingsPageActions>; report: ReportNotice }) {
  const { t, text } = useLocalization();
  const [section, setSection] = useState<SettingsCategory>(initialCategory);
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(settings);
  useEffect(() => setSaved(settings), [settings]);
  const { agents, theme, defaultLayout, shortcuts } = draft;
  const [submittedIssues, setSubmittedIssues] = useState<SettingsIssue[]>([]);
  const issues = [...submittedIssues, ...settingsIssues(draft)];
  const fieldError = (field: string) => text(issues.find(issue => issue.field === field)?.message ?? '');
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
    if (!dirty.length && !defaultShortcutConflict) return true;
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
        report(localize(result.settings.language).t('theme' in patch ? 'settingsSavedTheme' : 'settingsSaved'), 'success');
        return true;
      }
      let message: string;
      if (result.kind === 'validation') {
        setSubmittedIssues(result.issues);
        const first = settingsCategories.flatMap(category => result.issues.filter(issue => issue.category === category.id))[0];
        message = first?.code === 'conflict' ? t('settingsConflict') : t('settingsInvalid');
        if (first) {
          setSection(first.category); setSearch(''); setProblemToFocus(first);
        }
      } else message = text(result.message);
      setError(message); report(message);
      return false;
    }
    finally { pending.current = false; setSaving(false); }
  }
  async function saveAndLeave() {
    leaveDialog.current?.close();
    // The saved shortcuts hold the default shortcut conflict, so leaving always saves them.
    decideLeave(await save(defaultShortcutConflict && !leaveCategories.includes('shortcuts') ? [...leaveCategories, 'shortcuts'] : leaveCategories));
  }
  const query = search.trim().toLowerCase();
  const actions = shortcutActions.filter(action => `${t(action === 'settings' ? 'openSettings' : action)} ${shortcuts[action]} ${displayShortcut(shortcuts[action])}`.toLowerCase().includes(query));
  return <div className="settings-page">
    <div className="settings-shell"><button className="settings-back text-button" autoFocus disabled={saving} onClick={back}>{t('back')}</button>
      <h1>{t('settings')}</h1><div className="settings-columns">
        <nav className="settings-navigation" aria-label={t('settingsCategories')}>{settingsCategories.map(category => <button key={category.id} disabled={saving} aria-current={section === category.id ? 'page' : undefined} onClick={() => { setSection(category.id); setError(''); }}>{t(category.id)}</button>)}</nav>
        <div className="settings-content">
          <header className="settings-content-heading"><h2>{t('categorySettings', { category: t(section) })}</h2><div className="settings-save">
            <span className="settings-status" aria-live="polite">{error ? <span className="error-text" role="alert">{error}</span> : saving ? t('saving') : ''}</span>
            <button disabled={saving} onClick={() => replaceDraft(defaultSettings())}>{t('restoreDefaults')}</button>
            <button disabled={saving} onClick={() => replaceDraft(saved)}>{t('discardChanges')}</button>
            <button className="primary" disabled={saving} onClick={() => void save([section])}>{t('save')}</button>
          </div></header>
          <div className="settings-scroll" ref={scroll}><fieldset disabled={saving}>
          {section === 'general' && <><label htmlFor="interface-language">{t('language')}</label><select id="interface-language" data-settings-field="language" value={draft.language} onChange={event => changeDraft({ language: event.target.value as Settings['language'] })}><option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option></select><p className="muted">{t('languageHelp')}</p>{fieldError('language') && <p className="error-text" role="alert">{fieldError('language')}</p>}</>}
          {section === 'agents' && <form onSubmit={event => { event.preventDefault(); void save([section]); }}>
            <p className="muted">{t('agentSettingsHelp')}</p>
            {agentTypes.map(type => <AgentFields key={`${type}-${agentRevision}`} type={type} value={agents[type]} error={fieldError(`agents.${type}.command`)} argsError={fieldError(`agents.${type}.args`)} change={value => changeDraft({ agents: { ...agents, [type]: value } })} />)}
          </form>}
          {section === 'appearance' && <form onSubmit={event => { event.preventDefault(); void save([section]); }}>
            <h2>{t('theme')}</h2><p className="muted">{t('themeHelp')}</p>
            <div className="theme-options" role="radiogroup" aria-label={t('theme')} data-settings-field="theme" tabIndex={-1} aria-invalid={!!fieldError('theme') || undefined} aria-describedby={fieldError('theme') ? 'theme-error' : undefined}>{(['system', 'dark', 'light'] as const).map(option => <label key={option}><input type="radio" name="theme" value={option} checked={theme === option} onChange={() => changeDraft({ theme: option })} />{t(({ system: 'themeSystem', dark: 'themeDark', light: 'themeLight' } as const)[option])}</label>)}</div>
            {fieldError('theme') && <p id="theme-error" className="error-text" role="alert">{fieldError('theme')}</p>}
            {settings.theme !== startupTheme && <p className="restart-notice" role="status">{t('themeRestart')}</p>}
            <hr /><label htmlFor="default-layout">{t('defaultLayout')}</label><select id="default-layout" data-settings-field="defaultLayout" aria-invalid={!!fieldError('defaultLayout') || undefined} aria-describedby={fieldError('defaultLayout') ? 'layout-error' : undefined} value={defaultLayout} onChange={event => changeDraft({ defaultLayout: event.target.value as Settings['defaultLayout'] })}><option value="auto">{t('layoutAuto')}</option><option value="row">{t('layoutRow')}</option><option value="column">{t('layoutColumn')}</option></select>
            {fieldError('defaultLayout') && <p id="layout-error" className="error-text" role="alert">{fieldError('defaultLayout')}</p>}
            <p className="muted">{t('layoutHelp')}</p>
          </form>}
          {section === 'shortcuts' && <>
            <p className="muted">{t('shortcutHelp')}</p>
            <div className="shortcut-search"><input aria-label={t('shortcutSearch')} placeholder={t('shortcutSearch')} value={search} onChange={event => setSearch(event.target.value)} /></div>
            <p className="muted">{t('shortcutCount', { count: actions.length })}</p>
            {actions.map(action => {
              const groupIndex = conflicts.findIndex(group => group.actions.includes(action));
              const conflict = conflicts[groupIndex];
              const issue = fieldError(`shortcuts.${action}`);
              return <div className={`shortcut-row ${conflict ? 'shortcut-conflict' : ''}`} style={conflict ? { '--conflict-color': conflictColors[groupIndex] } as CSSProperties : undefined} key={action}><div><label htmlFor={`shortcut-${action}`}>{t(action === 'settings' ? 'openSettings' : action)}</label><small>{t('shortcutDefault', { binding: displayShortcut(defaults[action]) })}</small>{issue && <p id={`conflict-${action}`} className="shortcut-conflict-message error-text">{issue}</p>}</div>
              <input id={`shortcut-${action}`} data-settings-field={`shortcuts.${action}`} data-shortcut-recorder aria-invalid={!!issue || undefined} aria-describedby={issue ? `conflict-${action}` : undefined} title={shortcuts[action]} readOnly value={recording === action ? t('shortcutRecording') : displayShortcut(shortcuts[action])}
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
            <p className="muted shortcut-help">{t('shortcutScope')}</p>
          </>}
        </fieldset></div>
        </div>
      </div>
    </div>
    <dialog ref={leaveDialog} className="settings-leave" onCancel={event => { event.preventDefault(); decideLeave(false); }}>
      <h2>{t('settingsLeave')}</h2>
      {defaultShortcutConflict && <p>{t('settingsLeaveConflict')}</p>}
      {leaveCategories.length > 0 && <p>{t('settingsUnsaved', { categories: settingsCategories.filter(category => leaveCategories.includes(category.id)).map(category => t(category.id)) })}</p>}
      <div className="dialog-actions"><button onClick={() => decideLeave(false)}>{t('cancel')}</button>{!defaultShortcutConflict && <button onClick={() => decideLeave(true)}>{t('dontSave')}</button>}<button className="primary" onClick={() => void saveAndLeave()}>{t('saveAndReturn')}</button></div>
    </dialog>
  </div>;
}

export function SettingsPage(props: Parameters<typeof SettingsEditor>[0]) {
  return <Localization language={props.settings.language}><SettingsEditor {...props} /></Localization>;
}
