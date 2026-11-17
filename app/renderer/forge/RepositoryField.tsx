import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import { detail } from '../../shared/messages';
import type { ProjectView } from '../../shared/model';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import '../projects/project-management.css';

/** The repository field's form state. The choices load when the dialog opens and follow the directory being
 * edited; `repository` is the binding the project has after saving. A list that failed to load binds nothing new. */
export function useRepositoryField(project: ProjectView, directory: string) {
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

/** The account's repositories, searchable. Focus stays in the search box, picking with the pointer too, and there ↑/↓
 * move through the ones shown, without wrapping, keeping the one reached in view; Enter or Space picks it. Pointing at one reaches it too, and a new search reaches none until a key moves. */
function RepositoryList({ field, disabled }: { field: RepositoryFieldState; disabled: boolean }) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  /** The path of the repository the keys have reached. */
  const [reached, setReached] = useState<string>();
  const listId = useId();
  const optionId = (path: string) => `${listId}-${path}`;
  useEffect(() => { if (reached) document.getElementById(optionId(reached))?.scrollIntoView?.({ block: 'nearest' }); }, [reached]);
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
  const reachedIndex = shown.findIndex(item => item.path === reached);
  function keydown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown.length) return;
      const index = reachedIndex < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, reachedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      setReached(shown[index].path);
    } else if ((event.key === 'Enter' || event.code === 'Space') && reachedIndex >= 0) field.pick(shown[reachedIndex]);
    else return;
    event.preventDefault();
  }
  return <div className="repository-picker">
    <input type="search" aria-label={t('searchRepositories')} placeholder={t('searchRepositories')} autoComplete="off" value={query} disabled={disabled}
      aria-controls={listId} aria-activedescendant={reachedIndex >= 0 ? optionId(shown[reachedIndex].path) : undefined}
      onChange={event => { setQuery(event.target.value); setReached(undefined); }} onKeyDown={keydown} />
    {/* Pressing the list keeps focus in the search box, where its keys are answered. */}
    <div className="repository-list" id={listId} role="listbox" aria-labelledby="edit-project-repository" onMouseDown={event => event.preventDefault()}>
      {shown.map(item => <button type="button" role="option" key={item.path} id={optionId(item.path)} data-path={item.path} aria-selected={sameRepository(item, selection)}
        className={[sameRepository(item, selection) && 'on', item.path === reached && 'reached'].filter(Boolean).join(' ')}
        disabled={disabled} tabIndex={-1} onMouseEnter={() => setReached(item.path)} onClick={() => field.pick(item)}>
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
export function RepositoryField({ field, disabled, focus }: { field: RepositoryFieldState; disabled: boolean; focus: boolean }) {
  const { t } = useLocalization();
  const element = useRef<HTMLDivElement>(null);
  const focusPending = useRef(focus);
  // Opened for the repository, or the list shown by Change: focus goes to the field's first control once it is drawn,
  // i.e. the search box (or Retry) of the list, or Change for a bound project.
  useEffect(() => {
    if (!focusPending.current) return;
    const target = element.current!.querySelector<HTMLElement>(field.bound && !field.changing
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
      : <>
        <button type="button" disabled={disabled}
          onClick={() => { focusPending.current = true; field.change(); }}>{t('changeRepository')}</button>
        <button type="button" className="danger" disabled={disabled} onClick={field.unbind}>{t('unbind')}</button>
      </>}</span>
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

/** The binding change in the "After saving" list of a dialog that saves the field, when a bound project's changes. */
export function BindingImpact({ field }: { field: RepositoryFieldState }) {
  const { t } = useLocalization();
  const { bound, repository } = field;
  if (!bound || sameRepository(repository, bound)) return null;
  return <><dt>{t('repository')}</dt><dd><span className="project-path">{bound.path} → {repository?.path ?? t('doNotBind')}</span>
    <p>{repository ? t('rebindImpact') : t('unbindImpact')}</p></dd></>;
}

/** The sidebar's dialog for a project's Repository Binding alone: Edit project's repository field, opened with focus on
 * it, and saved by the same edit with the project's name and directory as they are, so no panel restarts. */
export function RepositoryBindingDialog({ project, close }: { project: ProjectView; close(): void }) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRepositoryField(project, project.directory);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const changed = !sameRepository(field.repository, field.bound);
  const title = t(field.bound ? 'changeBinding' : 'bindRepository');
  // Open before the field's effects run: it can take focus only inside an open dialog.
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  async function save() {
    if (busy || !changed) return;
    setBusy(true); setError('');
    try {
      const outcome = await window.workbench.editProject(project.id, { name: project.name, directory: project.directory, repository: field.repository }, false);
      if (outcome.error) setError(outcome.error); else close();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="project-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <h2>{title}</h2>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <RepositoryField field={field} disabled={busy} focus />
      {changed && field.bound && <section className="save-impact" aria-label={t('afterSave')}><b>{t('afterSave')}</b><dl><BindingImpact field={field} /></dl></section>}
      {error && <p className="error-text" role="alert">{text(error)}</p>}
      <div className="project-dialog-actions"><button type="button" disabled={busy} onClick={close}>{t('cancel')}</button>
        <button type="submit" className="primary" disabled={busy || !changed}>{busy ? t('saving') : t('saveChanges')}</button></div>
    </form>
  </dialog>;
}
