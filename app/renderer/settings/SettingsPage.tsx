import { Localization, useLocalization } from '../common/Localization';
import { localize } from '../../shared/localization/localization';
import { message } from '../../shared/messages';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Settings } from '../../shared/model';
import type { ShortcutAction } from '../../shared/settings/shortcuts';
import type { ReportNotice } from '../common/Notices';
import { AgentSettings } from './AgentSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { GeneralSettings } from './GeneralSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { WorkflowSettings } from './WorkflowSettings';
import { defaultSettings, dirtySettingsCategories, settingsCategories, settingsConflicts, settingsIssues, settingsPatch,
  type SettingsCategory, type SettingsIssue } from '../../shared/settings/settings';

export interface SettingsPageActions { requestLeave(): Promise<boolean>; showCategory(category: SettingsCategory): void }

function SettingsEditor({ settings, startupTheme, initialCategory = settingsCategories[0].id, back, ref, report }: {
  settings: Settings; startupTheme: Settings['theme']; initialCategory?: SettingsCategory; back(): void;
  ref: Ref<SettingsPageActions>; report: ReportNotice;
}) {
  const { t, text } = useLocalization();
  const [section, setSection] = useState<SettingsCategory>(initialCategory);
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(settings);
  useEffect(() => setSaved(settings), [settings]);
  const { agents, shortcuts } = draft;
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
  // A settings conflict lives in the saved settings, so leaving requires saving its category.
  const savedConflicts = settingsConflicts(saved);
  const conflicting = settingsCategories.filter(category => savedConflicts.some(issue => issue.category === category.id)).map(category => category.id);
  useImperativeHandle(ref, () => ({ async requestLeave() {
    if (pending.current || leaveDecision.current) return false;
    if (!dirty.length && !conflicting.length) return true;
    setLeaveCategories(dirty);
    return new Promise<boolean>(resolve => { leaveDecision.current = resolve; leaveDialog.current?.showModal(); });
  }, showCategory(category) { if (!pending.current && !leaveDecision.current) { setSection(category); setSearch(''); } } }));
  useEffect(() => () => { leaveDecision.current?.(false); }, []);
  function decideLeave(leave: boolean) {
    leaveDialog.current?.close(); setLeaveCategories([]);
    const resolve = leaveDecision.current; leaveDecision.current = undefined; resolve?.(leave);
  }
  function replaceDraft(values: Settings) {
    setError('');
    changeDraft(settingsPatch(values, [section]));
    setAgentRevision(value => value + 1); setRecording(undefined);
  }
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
    decideLeave(await save(settingsCategories.filter(category => leaveCategories.includes(category.id) || conflicting.includes(category.id)).map(category => category.id)));
  }
  return <div className="settings-page">
    <div className="settings-shell"><button className="settings-back text-button" autoFocus disabled={saving} onClick={back}>{t('back')}</button>
      <h1>{t('settings')}</h1><div className="settings-columns">
        <nav className="settings-navigation" aria-label={t('settingsCategories')}>{settingsCategories.map(category =>
          <button key={category.id} disabled={saving} aria-current={section === category.id ? 'page' : undefined}
            onClick={() => { setSection(category.id); setError(''); }}>{t(category.id)}</button>)}</nav>
        <div className="settings-content">
          <header className="settings-content-heading"><h2>{t('categorySettings', { category: t(section) })}</h2><div className="settings-save">
            <span className="settings-status" aria-live="polite">{error ? <span className="error-text" role="alert">{error}</span> : saving ? t('saving') : ''}</span>
            <button disabled={saving} onClick={() => replaceDraft(defaultSettings())}>{t('restoreDefaults')}</button>
            <button disabled={saving} onClick={() => replaceDraft(saved)}>{t('discardChanges')}</button>
            <button className="primary" disabled={saving} onClick={() => void save([section])}>{t('save')}</button>
          </div></header>
          <div className="settings-scroll" ref={scroll}><fieldset disabled={saving}>
          {section === 'general' && <GeneralSettings language={draft.language} fieldError={fieldError} changeDraft={changeDraft} />}
          {section === 'agents' && <AgentSettings agents={agents} agentRevision={agentRevision} fieldError={fieldError}
            changeDraft={changeDraft} submit={() => void save([section])} />}
          {section === 'workflows' && <WorkflowSettings values={draft.workflows} changeDraft={changeDraft} />}
          {section === 'appearance' && <AppearanceSettings draft={draft} savedTheme={settings.theme} startupTheme={startupTheme}
            fieldError={fieldError} changeDraft={changeDraft} submit={() => void save([section])} />}
          {section === 'shortcuts' && <ShortcutSettings shortcuts={shortcuts} search={search} setSearch={setSearch}
            recording={recording} setRecording={setRecording} fieldError={fieldError} changeDraft={changeDraft} />}
        </fieldset></div>
        </div>
      </div>
    </div>
    <dialog ref={leaveDialog} className="settings-leave" onCancel={event => { event.preventDefault(); decideLeave(false); }}>
      <h2>{t('settingsLeave')}</h2>
      {conflicting.length > 0 && <p>{t('settingsLeaveConflict', { categories: conflicting.map(category => t(category)) })}</p>}
      {leaveCategories.length > 0 && <p>{t('settingsUnsaved', { categories: settingsCategories.filter(category => leaveCategories.includes(category.id)).map(category => t(category.id)) })}</p>}
      <div className="dialog-actions">
        <button onClick={() => decideLeave(false)}>{t('cancel')}</button>
        {!conflicting.length && <button onClick={() => decideLeave(true)}>{t('dontSave')}</button>}
        <button className="primary" onClick={() => void saveAndLeave()}>{t('saveAndReturn')}</button>
      </div>
    </dialog>
  </div>;
}

export function SettingsPage(props: Parameters<typeof SettingsEditor>[0]) {
  return <Localization language={props.settings.language}><SettingsEditor {...props} /></Localization>;
}
