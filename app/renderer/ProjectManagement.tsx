import { useLocalization } from './Localization';
import { detail, message } from '../shared/messages';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type DirectoryResult, type Project, type ProjectEditResult, type ProjectView } from '../shared/model';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../shared/code-hosting';
import { projectNameError, projectNameHasControls } from '../shared/project-name';
import { LaunchResults } from './LaunchResults';
import './project-management.css';

export function ProjectNavigationItem({ project, openProject, children }: {
  project: ProjectView; openProject(id: string): void; children: ReactNode;
}) {
  const { t } = useLocalization();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [action, setAction] = useState<'edit' | 'delete'>();
  const menuElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menuElement.current?.contains(event.target as Node)) setMenu(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); } };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, [menu]);
  const showMenu = (x: number, y: number) => setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 168)), y: Math.max(8, Math.min(y, window.innerHeight - 92)) });
  return <div className="project-row" onContextMenu={event => { event.preventDefault(); showMenu(event.clientX, event.clientY); }}>
    {children}
    <button className="project-menu-trigger" aria-label={t('projectMenu', { name: project.name })} aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); showMenu(box.left, box.bottom); }}>⋯</button>
    {menu && <div className="project-menu" ref={menuElement} role="menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" onClick={() => { setMenu(undefined); setAction('edit'); }}>{t('editProject')}</button>
      <button role="menuitem" onClick={() => { setMenu(undefined); setAction('delete'); }}>{t('deleteProject')}</button>
    </div>}
    {action === 'edit' && <ProjectEditor project={project} running={project.panels.filter(panel => panel.run?.state === 'running').length} close={() => setAction(undefined)} openProject={id => { setAction(undefined); openProject(id); }} />}
    {action === 'delete' && <DeleteProject project={project} close={() => setAction(undefined)} />}
  </div>;
}

/** Loads the repositories a project can bind and tracks the one picked: the bound one, else the one origin points at. */
function useRepositoryPicker(project: ProjectView) {
  const [choices, setChoices] = useState<RepositoryChoices | { ok: false; error: string }>();
  const [picked, setPicked] = useState<RepositoryReference | null>(project.repository);
  const load = () => {
    setChoices(undefined);
    void window.workbench.repositoryChoices(project.id).then(result => {
      setChoices(result);
      if (result.ok && !project.repository) setPicked(result.origin);
    }, error => setChoices({ ok: false, error: (error as Error).message }));
  };
  useEffect(load, [project.id]);
  // A binding changes only from a listed repository; a failed list leaves the binding as it is.
  const change = choices?.ok && picked && !sameRepository(picked, project.repository) ? picked : undefined;
  return { choices, picked, setPicked, load, change };
}

function RepositoryField({ project, picker, disabled }: { project: ProjectView; picker: ReturnType<typeof useRepositoryPicker>; disabled: boolean }) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const { choices, picked, setPicked, load } = picker;
  const retry = <button type="button" onClick={load}>{t('retry')}</button>;
  let body: ReactNode;
  if (!choices) body = <span className="muted">{t('loadingRepositories')}</span>;
  else if (!choices.ok && 'error' in choices) body = <div className="repository-error"><span>{t('repositoryListFailed', { reason: detail(choices.error) })}</span>{retry}</div>;
  else if (!choices.ok) {
    const { kind, detail: reason, platform } = choices.failure;
    body = <div className="repository-error">
      {kind === 'notInstalled' ? <><span>{t('codeHostingNotInstalled', { cli: platform.cli })}</span><a href={platform.installUrl} target="_blank" rel="noreferrer">{t('installInstructions')}</a></>
        : kind === 'loggedOut' ? <span>{t('codeHostingLoggedOut', { cli: platform.cli, command: platform.loginCommand })}</span>
        : <span>{t('repositoryListFailed', { reason: reason ? detail(reason) : kind })}</span>}
      {retry}</div>;
  } else {
    // The bound repository stays visible even when the account no longer lists it.
    const repositories = project.repository && !choices.repositories.some(item => sameRepository(item, project.repository))
      ? [project.repository, ...choices.repositories] : choices.repositories;
    const term = query.trim().toLowerCase();
    const shown = repositories.filter(item => item.path.toLowerCase().includes(term));
    body = <div className="repository-picker">
      <input type="search" aria-label={t('searchRepositories')} placeholder={t('searchRepositories')} autoComplete="off" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
      <div className="repository-list" role="listbox" aria-labelledby="edit-project-repository">
        {shown.map(item => <button type="button" role="option" key={item.path} data-path={item.path} aria-selected={sameRepository(item, picked)} className={sameRepository(item, picked) ? 'on' : ''} disabled={disabled} onClick={() => setPicked(item)}>
          <span className="repository-path">{item.path}</span>
          {sameRepository(item, choices.origin) && <small>{t('repositoryOrigin')}</small>}
          {sameRepository(item, project.repository) && <small>{t('repositoryCurrent')}</small>}
        </button>)}
        {!shown.length && <span className="muted repository-empty">{t('noRepositories')}</span>}
      </div>
      <span className="muted repository-source">{t('repositoryListSource', { cli: choices.platform.cli })}</span>
    </div>;
  }
  return <div className="repository-field"><span id="edit-project-repository" className="repository-label">{t('repository')}</span>{body}</div>;
}

function ProjectEditor({ project, running, close, openProject }: { project: ProjectView; running: number; close(): void; openProject(id: string): void }) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [original] = useState(project);
  const [name, setName] = useState(project.name), [path, setPath] = useState(project.directory);
  const [inspection, setInspection] = useState<{ path: string; result: DirectoryResult }>({ path: project.directory, result: { valid: true, directory: project.directory } });
  const [nameInputError, setNameInputError] = useState('');
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<ProjectEditResult>();
  const picker = useRepositoryPicker(project);
  const [confirm, setConfirm] = useState<{ kind: 'change'; restart: boolean } | { kind: 'unbind' }>();
  const directory = inspection.path === path ? inspection.result : undefined;
  const checking = !!path && !directory;
  const duplicate = directory?.existingProjectId && directory.existingProjectId !== project.id;
  const nameError = text(nameInputError || projectNameError(name));
  const directoryError = !path ? t('directoryRequired') : checking ? '' : !directory?.valid ? t('directoryInvalid')
    : duplicate ? t('duplicateEdit', { name: directory.existingProjectName! }) : '';
  const changedDirectory = !!directory?.valid && !duplicate && directory.directory !== original.directory;
  const canSave = !busy && !choosing && !checking && !nameError && !directoryError;
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    let live = true;
    if (!path) return;
    const timer = setTimeout(() => {
      void window.workbench.inspectDirectory(path).then(result => { if (live) setInspection({ path, result }); })
        .catch(error => { if (live) { setInspection({ path, result: { valid: false } }); setError(error.message); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [path]);
  async function save(restart: boolean, confirmed = false) {
    if (!canSave) return;
    const change = picker.change;
    if (change && project.repository && !confirmed) { setConfirm({ kind: 'change', restart }); return; }
    setConfirm(undefined); setBusy(true); setError('');
    try {
      // The binding is saved only once the name and directory are.
      const outcome = await window.workbench.editProject(project.id, { name, directory: path }, restart);
      if (change) await window.workbench.bindRepository(project.id, change);
      if (outcome.error || outcome.launches.length) setResult(outcome); else close();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function unbind() {
    setConfirm(undefined); setBusy(true); setError('');
    try { await window.workbench.bindRepository(project.id, null); close(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="project-dialog" aria-label={t('editProject')} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>{result ? t('projectEditResult') : t('editProject')}</h2>
    {result ? <>
      <p>{t('projectSaved', { name: result.project.name })}</p><p className="project-path">{result.project.directory}</p>
      {result.error && <p className="error-text" role="alert">{text(result.error)}</p>}
      {!!result.launches.length && <><p>{result.launches.every(launch => launch.outcome === 'started') ? t('panelsRestarted') : t('panelsRestartUnconfirmed')}</p>
        <LaunchResults launches={result.launches} /></>}
      <div className="project-dialog-actions"><button className="primary" onClick={close}>{t('finish')}</button></div>
    </> : <form onSubmit={event => { event.preventDefault(); if (!changedDirectory) void save(false); }}>
      <label htmlFor="edit-project-name">{t('projectName')}</label><input id="edit-project-name" autoFocus autoComplete="off" value={name} disabled={busy} aria-invalid={!!nameError} aria-describedby="edit-project-name-status" onChange={event => { setNameInputError(''); setName(event.target.value); }} onPaste={event => {
        if (projectNameHasControls(event.clipboardData.getData('text'))) { event.preventDefault(); setNameInputError(message('nameControls')); }
        else setNameInputError('');
      }} />
      {nameError && <div id="edit-project-name-status" className="field-status error-text">{nameError}</div>}
      <label htmlFor="edit-project-directory">{t('localDirectory')}</label><div className="directory-input"><input id="edit-project-directory" autoComplete="off" value={path} disabled={busy} aria-invalid={!!directoryError} aria-describedby="edit-project-directory-status" onChange={event => setPath(event.target.value)} /><button type="button" disabled={busy || choosing} aria-label={t('chooseNewDirectory')} onClick={async () => { setChoosing(true); try { const selected = await window.workbench.chooseDirectory(); if (selected !== null) setPath(selected); } catch (error) { setError((error as Error).message); } finally { setChoosing(false); } }}>{t('browse')}</button></div>
      {(checking || directoryError) && <div id="edit-project-directory-status" className="field-status" aria-live="polite">{checking ? t('checkingDirectory') : <span className="error-text">{directoryError}</span>}{duplicate && <button type="button" className="open-existing-project" onClick={() => openProject(directory!.existingProjectId!)}>{t('openExisting')}</button>}</div>}
      <RepositoryField project={project} picker={picker} disabled={busy} />
      {confirm && <div className="repository-confirm" role="group" aria-label={t('confirm')}>
        <span>{confirm.kind === 'change' ? t('changeBindingQuestion', { from: project.repository!.path, to: picker.picked!.path }) : t('unbindQuestion', { repository: project.repository!.path })}</span>
        <span className="repository-confirm-actions"><button type="button" onClick={() => setConfirm(undefined)}>{t('cancel')}</button>
          <button type="button" className="primary" onClick={() => void (confirm.kind === 'change' ? save(confirm.restart, true) : unbind())}>{confirm.kind === 'change' ? t('changeBinding') : t('unbind')}</button></span>
      </div>}
      {changedDirectory && <section className="directory-change" aria-label={t('directoryChange')}><dl><dt>{t('oldDirectory')}</dt><dd>{original.directory}</dd><dt>{t('newDirectory')}</dt><dd>{directory!.directory}</dd></dl><p>{t('currentRuns', { count: running })}</p>
        <p><strong>{t('changeAndRestart')}: </strong>{t('restartImpact')}</p>
        <p><strong>{t('changeWithoutRestart')}: </strong>{t('noRestartImpact')}</p>
        <p>{t('directoryHistory')}</p>
      </section>}
      {error && <p className="error-text" role="alert">{text(error)}</p>}
      <div className="project-dialog-actions">{project.repository && <button type="button" className="danger unbind-repository" disabled={busy} onClick={() => setConfirm({ kind: 'unbind' })}>{t('unbind')}</button>}<button type="button" disabled={busy} onClick={close}>{changedDirectory ? t('cancelChange') : t('cancel')}</button>{changedDirectory ? <><button type="button" disabled={!canSave} onClick={() => void save(false)}>{t('changeWithoutRestart')}</button><button className="primary" type="button" disabled={!canSave} onClick={() => void save(true)}>{busy ? t('processing') : t('changeAndRestart')}</button></> : <button type="submit" className="primary" disabled={!canSave}>{busy ? t('saving') : t('saveChanges')}</button>}</div>
    </form>}
  </dialog>;
}

function DeleteProject({ project, close }: { project: Project; close(): void }) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="project-dialog delete-project-dialog" aria-label={t('deleteProject')} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>{t('deleteProjectQuestion', { name: project.name })}</h2><p>{t('deleteProjectImpact')}</p><p>{t('deleteProjectHistory')}</p>
    {error && <p className="error-text" role="alert">{text(error)}</p>}
    <div className="project-dialog-actions"><button autoFocus disabled={busy} onClick={close}>{t('cancel')}</button><button className="danger" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await window.workbench.deleteProject(project.id); close(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>{busy ? t('deleting') : t('confirmDelete')}</button></div>
  </dialog>;
}
