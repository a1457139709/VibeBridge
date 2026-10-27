import { useLocalization } from './Localization';
import { message } from '../shared/messages';
import { agentIcons } from './agent-icons';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { agentNames, agentTypes, arrange, assignedAgents, type DefaultLayout, type DirectoryResult, type LaunchResult, type ProjectDraft } from '../shared/model';
import { LaunchResults } from './LaunchResults';
import { layoutBoxes } from '../shared/layout';
import { projectNameError, projectNameFromDirectory, projectNameHasControls } from '../shared/project-name';

function Stepper({ label, value, decrease, increase, canDecrease, canIncrease }: { label: string; value: number; decrease(): void; increase(): void; canDecrease: boolean; canIncrease: boolean }) {
  const { t } = useLocalization();
  return <div className="stepper"><button type="button" aria-label={t('decrease', { label })} disabled={!canDecrease} onClick={decrease}>−</button><output>{value}</output><button type="button" aria-label={t('increase', { label })} disabled={!canIncrease} onClick={increase}>＋</button></div>;
}
export function Setup({ draft, change, cancel, created, openProject, report, openAgentSettings, defaultLayout }: { draft: ProjectDraft; change: Dispatch<SetStateAction<ProjectDraft>>; cancel(): void; created(id: string): void; openProject(id: string): void; report(message: string): void; openAgentSettings(): void; defaultLayout: DefaultLayout }) {
  const { t, text } = useLocalization();
  const [inspection, setInspection] = useState<{ path: string; result: DirectoryResult }>();
  const [nameTouched, setNameTouched] = useState(false);
  const [directoryTouched, setDirectoryTouched] = useState(false);
  const [nameInputError, setNameInputError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<{ projectId: string; launches: LaunchResult[] }>();
  const pending = useRef(false);
  const directory = inspection?.path === draft.directory ? inspection.result : undefined;
  const checking = !!draft.directory && !directory;
  const nameError = text(projectNameError(draft.name));
  const nameMessage = text(nameInputError) || (nameTouched || draft.name.trim() ? nameError : '');
  const directoryMessage = !draft.directory ? (directoryTouched ? t('directoryRequired') : '')
    : checking ? '' : !directory?.valid ? t('directoryInvalid')
    : directory.existingProjectId ? t('duplicateCreate', { name: directory.existingProjectName! }) : '';
  const assigned = agentTypes.reduce((sum, type) => sum + draft.counts[type], 0);
  const canCreate = !busy && !choosing && !!directory?.valid && !directory.existingProjectId && !nameError && !nameInputError && assigned === draft.total;
  useEffect(() => {
    setInspection(undefined);
    if (!draft.directory) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.workbench.inspectDirectory(draft.directory).then(result => {
        if (live) setInspection({ path: draft.directory, result });
      }).catch(error => { if (live) { setInspection({ path: draft.directory, result: { valid: false } }); report(error.message); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [draft.directory]);
  async function chooseDirectory() {
    setChoosing(true);
    try {
      const path = await window.workbench.chooseDirectory();
      if (path === null) return;
      change(current => ({ ...current, directory: path, name: current.name.trim() ? current.name : projectNameFromDirectory(path) }));
      setNameInputError(''); setNameTouched(true); setDirectoryTouched(true);
    } catch (error) { report((error as Error).message); }
    finally { setChoosing(false); }
  }
  const types = assignedAgents(draft);
  const preview = Array.from({ length: Math.max(draft.total, assigned) }, (_, index) => String(index));
  const boxes = layoutBoxes(arrange(preview, defaultLayout)).panels;
  async function submit() {
    if (pending.current) return;
    if (!canCreate) { setNameTouched(true); setDirectoryTouched(true); return; }
    pending.current = true; setBusy(true);
    try {
      // Failed launches are already withdrawn from the project.
      const { project, launches } = await window.workbench.createProject(draft);
      if (launches.every(launch => launch.outcome === 'started')) created(project.id);
      else setLaunched({ projectId: project.id, launches });
    }
    catch (error) { report((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  if (launched) {
    const failed = launched.launches.some(launch => launch.outcome === 'failed');
    return <div className="setup-scroll"><section className="setup">
      <h1>{t('createProject')}</h1>{failed && <p role="status">{t('setupLaunchFailed')}</p>}
      <LaunchResults launches={launched.launches} />
      <div className="setup-actions">{failed && <button type="button" onClick={() => { created(launched.projectId); openAgentSettings(); }}>{t('openAgentSettings')}</button>}<button type="button" className="primary" autoFocus onClick={() => created(launched.projectId)}>{t('finish')}</button></div>
    </section></div>;
  }
  return <div className="setup-scroll"><form className="setup" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h1>{t('createProject')}</h1><p className="muted intro">{t('setupIntro')}</p>
    <label htmlFor="project-name">{t('projectName')}</label><input id="project-name" value={draft.name} aria-invalid={!!nameMessage} aria-describedby="project-name-status" onBlur={() => setNameTouched(true)} onChange={event => { setNameInputError(''); change({ ...draft, name: event.target.value }); }} onPaste={event => {
      const text = event.clipboardData.getData('text');
      if (projectNameHasControls(text)) { event.preventDefault(); setNameInputError(message('nameControls')); }
      else setNameInputError('');
    }} autoComplete="off" />
    <div id="project-name-status" className="field-status" hidden={!nameMessage} aria-live="polite">{nameMessage && <span className="error-text">{nameMessage}</span>}</div>
    <label htmlFor="project-directory">{t('localDirectory')}</label><div className="directory-input"><input id="project-directory" value={draft.directory} aria-invalid={!!directoryMessage} aria-describedby="project-directory-status" onBlur={() => setDirectoryTouched(true)} onChange={event => change({ ...draft, directory: event.target.value })} placeholder="/Users/you/Projects/my-project" autoComplete="off" /><button type="button" aria-label={t('chooseDirectory')} disabled={choosing} onClick={() => void chooseDirectory()}>{t('browse')}</button></div>
    <div id="project-directory-status" className="directory-status field-status" hidden={!checking && !directoryMessage && !directory?.existingProjectId} aria-live="polite">
      {checking ? t('checkingDirectory') : directoryMessage && <span className="error-text">{directoryMessage}</span>}
      {directory?.existingProjectId && <button type="button" className="open-existing-project" onClick={() => openProject(directory.existingProjectId!)}>{t('openExisting')}</button>}
    </div>
    <hr /><label>{t('layoutPreview')}</label><div className="preview" style={{ height: Math.max(264, Math.ceil(preview.length / 2) * 72) }} aria-label={t('readOnlyPreview')}>
      {preview.map((id, index) => { const box = boxes.get(id)!; const type = types[index]; return <div className={`preview-panel ${type || ''}`} key={id} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="agent-mark">{type ? agentIcons[type] : '＋'}</span><span>{type ? agentNames[type] : t('unassigned')}</span><small>{index + 1}</small></div>; })}
    </div>
    <div className="quantity-row"><span>{t('windowCount')}</span><Stepper label={t('windowCount')} value={draft.total} decrease={() => change({ ...draft, total: draft.total - 1 })} increase={() => change({ ...draft, total: draft.total + 1 })} canDecrease={draft.total > 1} canIncrease={draft.total < 10} /></div>
    <label className="allocation-label">{t('assignAgents')}</label>{agentTypes.map(type => <div className={`quantity-row ${type}`} key={type}><span><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</span><Stepper label={agentNames[type]} value={draft.counts[type]} decrease={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] - 1 } })} increase={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] + 1 } })} canDecrease={draft.counts[type] > 0} canIncrease={assigned < draft.total} /></div>)}
    <div className="allocation-status" aria-live="polite"><span>{t('assigned', { count: assigned, total: draft.total })}</span><span className={assigned > draft.total ? 'error-text' : 'muted'}>{assigned < draft.total ? t('assignRemaining', { count: draft.total - assigned }) : assigned > draft.total ? t('assignExcess', { count: assigned - draft.total }) : t('assignmentComplete')}</span></div>
    <div className="setup-actions"><button type="button" onClick={cancel} disabled={busy}>{t('cancel')}</button><button className="primary" type="submit" disabled={!canCreate}>{busy ? t('creating') : t('createAndStart')}</button></div>
  </form></div>;
}
