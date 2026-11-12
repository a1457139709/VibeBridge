import { useLocalization } from './Localization';
import { detail, message } from '../shared/messages';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type DirectoryResult, type Project, type ProjectEditResult, type ProjectView } from '../shared/model';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../shared/forge';
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
    {action === 'edit' && <ProjectEditor project={project} close={() => setAction(undefined)} openProject={id => { setAction(undefined); openProject(id); }} />}
    {action === 'delete' && <DeleteProject project={project} close={() => setAction(undefined)} />}
  </div>;
}

/** The repository field's form state. The choices load when the dialog opens and follow the directory being
 * edited; `repository` is the binding the project has after saving. A list that failed to load binds nothing new. */
function useRepositoryField(project: ProjectView, directory: string) {
  const bound = project.repository;
  const [choices, setChoices] = useState<RepositoryChoices | { ok: false; error: string }>();
  const [attempt, setAttempt] = useState(0);
  const [changing, setChanging] = useState(false), [unbinding, setUnbinding] = useState(false);
  // undefined follows the default: the bound repository, else the one origin points at.
  const [picked, setPicked] = useState<RepositoryReference | null>();
  useEffect(() => {
    let live = true;
    void window.workbench.repositoryChoices(project.id, directory).then(result => { if (live) setChoices(result); },
      error => { if (live) setChoices({ ok: false, error: (error as Error).message }); });
    return () => { live = false; };
  }, [project.id, directory, attempt]);
  const listed = choices?.ok ? choices : undefined;
  const selection = picked !== undefined ? picked : bound ?? listed?.origin ?? null;
  const repository = bound
    ? unbinding ? null : changing && listed && selection ? selection : bound
    : listed ? selection : null;
  return {
    bound, choices, listed, selection, repository, changing, unbinding,
    retry() { setChoices(undefined); setAttempt(value => value + 1); },
    pick: setPicked,
    change() { setChanging(true); },
    unbind() { setUnbinding(true); },
    undo() { setChanging(false); setUnbinding(false); setPicked(undefined); },
  };
}
type RepositoryFieldState = ReturnType<typeof useRepositoryField>;

function RepositoryList({ field, disabled }: { field: RepositoryFieldState; disabled: boolean }) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const { choices, bound, selection } = field;
  const retry = <button type="button" onClick={field.retry}>{t('retry')}</button>;
  if (!choices) return <span className="muted">{t('loadingRepositories')}</span>;
  if (!choices.ok && 'error' in choices) return <div className="repository-error"><span>{t('repositoryListFailed', { reason: detail(choices.error) })}</span>{retry}</div>;
  if (!choices.ok) {
    const { kind, detail: reason, forge } = choices.failure;
    return <div className="repository-error">
      {kind === 'notInstalled' ? <><span>{t('forgeNotInstalled', { cli: forge.cli })}</span><a href={forge.installUrl} target="_blank" rel="noreferrer">{t('installInstructions')}</a></>
        : kind === 'loggedOut' ? <span>{t('forgeLoggedOut', { cli: forge.cli, command: forge.loginCommand })}</span>
        : <span>{t('repositoryListFailed', { reason: reason ? detail(reason) : kind })}</span>}
      {retry}</div>;
  }
  // The bound repository stays visible even when the account no longer lists it.
  const repositories = bound && !choices.repositories.some(item => sameRepository(item, bound)) ? [bound, ...choices.repositories] : choices.repositories;
  const term = query.trim().toLowerCase();
  const shown = repositories.filter(item => item.path.toLowerCase().includes(term));
  return <div className="repository-picker">
    <input type="search" aria-label={t('searchRepositories')} placeholder={t('searchRepositories')} autoComplete="off" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
    <div className="repository-list" role="listbox" aria-labelledby="edit-project-repository">
      {shown.map(item => <button type="button" role="option" key={item.path} data-path={item.path} aria-selected={sameRepository(item, selection)} className={sameRepository(item, selection) ? 'on' : ''} disabled={disabled} onClick={() => field.pick(item)}>
        <span className="repository-path">{item.path}</span>
        {sameRepository(item, choices.origin) && <small>{t('repositoryOrigin')}</small>}
        {sameRepository(item, bound) && <small>{t('repositoryCurrent')}</small>}
      </button>)}
      {!shown.length && <span className="muted repository-empty">{t('noRepositories')}</span>}
    </div>
    <span className="muted repository-source">{t('repositoryListSource', { cli: choices.forge.cli })}</span>
  </div>;
}

/** Bound: the repository with 更换 and 解绑, and the list only after 更换. Unbound: the list, with what saving binds. */
function RepositoryField({ field, disabled, focus }: { field: RepositoryFieldState; disabled: boolean; focus: boolean }) {
  const { t } = useLocalization();
  const element = useRef<HTMLDivElement>(null);
  const focusPending = useRef(focus);
  // Opened for the repository: focus goes to the field's first control once it is drawn, i.e. the search
  // box (or Retry) of the list, or Change for a bound project.
  useEffect(() => {
    if (!focusPending.current) return;
    const target = element.current!.querySelector<HTMLElement>(field.bound
      ? '.repository-current-actions button' : '.repository-picker input, .repository-error button');
    if (target) { target.focus(); focusPending.current = false; }
  });
  const { bound, repository } = field;
  const changed = !sameRepository(repository, bound);
  let summary: ReactNode;
  if (bound) summary = <>
    <span className="repository-path"><b>{bound.path}</b>{changed ? <> → <b>{repository?.path ?? t('doNotBind')}</b></> : <small> {t('repositoryCurrent')}</small>}</span>
    <span className="repository-current-actions">{field.changing || field.unbinding
      ? <button type="button" disabled={disabled} onClick={field.undo}>{t('undo')}</button>
      : <><button type="button" disabled={disabled} onClick={field.change}>{t('changeRepository')}</button><button type="button" className="danger" disabled={disabled} onClick={field.unbind}>{t('unbind')}</button></>}</span>
  </>;
  else summary = <>
    <span className="repository-path">{repository ? t('bindAfterSave', { repository: repository.path }) : t('notBound')}</span>
    {repository && <span className="repository-current-actions"><button type="button" disabled={disabled} onClick={() => field.pick(null)}>{t('doNotBind')}</button></span>}
  </>;
  const listShown = bound ? field.changing : true;
  return <div className="repository-field" ref={element}><span id="edit-project-repository" className="repository-label">{t('repository')}</span>
    <div className={`repository-current${changed ? ' changed' : ''}`}>{summary}</div>
    {listShown && <RepositoryList field={field} disabled={disabled} />}
  </div>;
}

/** The edit-project dialog. `focusRepository` opens it with focus on the repository field instead of the name. */
export function ProjectEditor({ project, close, openProject, focusRepository = false }: { project: ProjectView; close(): void; openProject(id: string): void; focusRepository?: boolean }) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [original] = useState(project);
  const running = project.panels.filter(panel => panel.run?.state === 'running').length;
  const [name, setName] = useState(project.name), [path, setPath] = useState(project.directory);
  const [inspection, setInspection] = useState<{ path: string; result: DirectoryResult }>({ path: project.directory, result: { valid: true, directory: project.directory } });
  const [nameInputError, setNameInputError] = useState('');
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<{ outcome: ProjectEditResult; repository: { from: RepositoryReference | null; to: RepositoryReference | null } }>();
  // The default repository follows the directory being edited once it has been inspected.
  const field = useRepositoryField(project, inspection.result.valid ? inspection.result.directory! : original.directory);
  const bound = original.repository, repository = field.repository;
  const bindingChanged = !sameRepository(repository, bound);
  const directory = inspection.path === path ? inspection.result : undefined;
  const checking = !!path && !directory;
  const duplicate = directory?.existingProjectId && directory.existingProjectId !== project.id;
  const nameError = text(nameInputError || projectNameError(name));
  const directoryError = !path ? t('directoryRequired') : checking ? '' : !directory?.valid ? t('directoryInvalid')
    : duplicate ? t('duplicateEdit', { name: directory.existingProjectName! }) : '';
  const changedDirectory = !!directory?.valid && !duplicate && directory.directory !== original.directory;
  const edited = name.trim() !== original.name || path !== original.directory || bindingChanged;
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
  // The only save: name, directory and binding go in one call, which saves all of them or none.
  async function save(restart: boolean) {
    if (!canSave) return;
    setBusy(true); setError('');
    try {
      const outcome = await window.workbench.editProject(project.id, { name, directory: path, repository }, restart);
      if (outcome.error || outcome.launches.length) setResult({ outcome, repository: { from: bound, to: repository } }); else close();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const impact = changedDirectory || (!!bound && bindingChanged);
  return <dialog ref={dialog} className="project-dialog" aria-label={t('editProject')} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>{result ? t('projectEditResult') : t('editProject')}</h2>
    {result ? <>
      <p>{t('projectSaved', { name: result.outcome.project.name })}</p><p className="project-path">{result.outcome.project.directory}</p>
      {!sameRepository(result.repository.from, result.repository.to) && <p className="project-path">{result.repository.to
        ? t('repositoryBound', { repository: result.repository.to.path }) : t('repositoryUnbound', { repository: result.repository.from!.path })}</p>}
      {result.outcome.error && <p className="error-text" role="alert">{text(result.outcome.error)}</p>}
      {!!result.outcome.launches.length && <><p>{result.outcome.launches.every(launch => launch.outcome === 'started') ? t('panelsRestarted') : t('panelsRestartUnconfirmed')}</p>
        <LaunchResults launches={result.outcome.launches} /></>}
      <div className="project-dialog-actions"><button className="primary" onClick={close}>{t('finish')}</button></div>
    </> : <form onSubmit={event => { event.preventDefault(); if (!changedDirectory && edited) void save(false); }}>
      <label htmlFor="edit-project-name">{t('projectName')}</label><input id="edit-project-name" autoFocus={!focusRepository} autoComplete="off" value={name} disabled={busy} aria-invalid={!!nameError} aria-describedby="edit-project-name-status" onChange={event => { setNameInputError(''); setName(event.target.value); }} onPaste={event => {
        if (projectNameHasControls(event.clipboardData.getData('text'))) { event.preventDefault(); setNameInputError(message('nameControls')); }
        else setNameInputError('');
      }} />
      {nameError && <div id="edit-project-name-status" className="field-status error-text">{nameError}</div>}
      <label htmlFor="edit-project-directory">{t('localDirectory')}</label><div className="directory-input"><input id="edit-project-directory" autoComplete="off" value={path} disabled={busy} aria-invalid={!!directoryError} aria-describedby="edit-project-directory-status" onChange={event => setPath(event.target.value)} /><button type="button" disabled={busy || choosing} aria-label={t('chooseNewDirectory')} onClick={async () => { setChoosing(true); try { const selected = await window.workbench.chooseDirectory(); if (selected !== null) setPath(selected); } catch (error) { setError((error as Error).message); } finally { setChoosing(false); } }}>{t('browse')}</button></div>
      {(checking || directoryError) && <div id="edit-project-directory-status" className="field-status" aria-live="polite">{checking ? t('checkingDirectory') : <span className="error-text">{directoryError}</span>}{duplicate && <button type="button" className="open-existing-project" onClick={() => openProject(directory!.existingProjectId!)}>{t('openExisting')}</button>}</div>}
      <RepositoryField field={field} disabled={busy} focus={focusRepository} />
      {/* Every consequence of saving is listed here, above the buttons that save; this is the confirmation. */}
      {impact && <section className="save-impact" aria-label={t('afterSave')}><b>{t('afterSave')}</b><dl>
        {changedDirectory && <><dt>{t('directory')}</dt><dd><span className="project-path">{original.directory} → {directory!.directory}</span>
          <p>{t('currentRuns', { count: running })}</p>
          <p><strong>{t('changeAndRestart')}: </strong>{t('restartImpact')}</p>
          <p><strong>{t('changeWithoutRestart')}: </strong>{t('noRestartImpact')}</p>
          <p>{t('directoryHistory')}</p></dd></>}
        {!!bound && bindingChanged && <><dt>{t('repository')}</dt><dd><span className="project-path">{bound.path} → {repository?.path ?? t('doNotBind')}</span>
          <p>{repository ? t('rebindImpact') : t('unbindImpact')}</p></dd></>}
      </dl></section>}
      {error && <p className="error-text" role="alert">{text(error)}</p>}
      <div className="project-dialog-actions"><button type="button" disabled={busy} onClick={close}>{changedDirectory ? t('cancelChange') : t('cancel')}</button>{changedDirectory ? <><button type="button" disabled={!canSave} onClick={() => void save(false)}>{t('changeWithoutRestart')}</button><button className="primary" type="button" disabled={!canSave} onClick={() => void save(true)}>{busy ? t('processing') : t('changeAndRestart')}</button></> : <button type="submit" className="primary" disabled={!canSave || !edited}>{busy ? t('saving') : t('saveChanges')}</button>}</div>
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
