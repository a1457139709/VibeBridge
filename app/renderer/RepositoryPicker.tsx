import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalization } from './Localization';
import { PlatformFailureHelp, platformFailureReason } from './platform-failure';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../shared/code-hosting';

/** What the field shows: nothing yet, the platform's answer, or a request that did not reach the Workbench. */
type Loaded = RepositoryChoices | { ok: false; error: string } | undefined;

/**
 * The edit-project field that picks a project's Repository Binding from the platform's list.
 * Only listed repositories can be chosen: the text box only searches. An unbound project starts
 * on the repository its directory's `origin` points to; the choice is bound when the project is saved.
 */
export function RepositoryPicker({ projectId, bound, value, onChange, disabled, holdFocus = false }: {
  projectId: string; bound: RepositoryReference | undefined; value: RepositoryReference | null;
  onChange(repository: RepositoryReference | null): void; disabled: boolean;
  /** Opened to bind a repository: the field keeps focus while its list loads, unless the user moves it. */
  holdFocus?: boolean;
}) {
  const { t, text } = useLocalization();
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    setLoaded(undefined);
    void window.workbench.repositoryChoices(projectId).then(result => {
      if (!live) return;
      setLoaded(result);
      // The suggestion is applied once, when the list arrives for an unbound project.
      if (result.ok && !bound && result.suggested) onChange(result.suggested);
    }, (error: Error) => { if (live) setLoaded({ ok: false, error: error.message }); });
    return () => { live = false; };
  }, [projectId, attempt]);
  const field = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    const free = !active || active === document.body || active.tagName === 'DIALOG' || field.current?.contains(active);
    if (holdFocus && loaded && free) field.current?.querySelector<HTMLElement>('[data-repository-focus]')?.focus();
  }, [loaded]);
  const options = loaded?.ok ? loaded.repositories.filter(repository => repository.path.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <div className="repository-field" ref={field}>
    <label htmlFor="edit-project-repository">{t('repository')}</label>
    {!loaded ? <div className="field-status" role="status" aria-label={t('repository')} tabIndex={-1} data-repository-focus>{t('loadingRepositories')}</div>
      : !loaded.ok ? <div className="field-status repository-failure" role="status" aria-label={t('repository')}>
        <span className="error-text">{'failure' in loaded ? platformFailureReason(t, loaded.failure, {
          failed: reason => t('repositoryListFailed', { platform: loaded.failure.platform.name, reason }) }) : text(loaded.error)}</span>
        {'failure' in loaded && <PlatformFailureHelp failure={loaded.failure} />}
        <button type="button" data-repository-focus onClick={() => setAttempt(count => count + 1)}>{t('retry')}</button>
      </div>
      : <>
        <input id="edit-project-repository" data-repository-focus role="combobox" aria-expanded="true" aria-controls="edit-project-repositories" autoComplete="off"
          placeholder={t('searchRepositories')} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            // Enter never submits the dialog from here; it picks the only remaining match.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (options.length === 1) onChange(options[0]);
          }} />
        {options.length
          ? <ul id="edit-project-repositories" className="repository-options" role="listbox" aria-label={t('repositories')}>
            {options.map(repository => <li key={repository.path} role="option" aria-selected={sameRepository(repository, value)}
              aria-disabled={disabled} onClick={() => { if (!disabled) onChange(repository); }}>{repository.path}</li>)}
          </ul>
          : <div id="edit-project-repositories" className="field-status">{t('noMatchingRepositories')}</div>}
      </>}
    <div className="repository-selection">
      <span>{value ? t('repositorySelected', { path: value.path }) : t('repositoryUnbound')}</span>
      {value && <button type="button" disabled={disabled} onClick={() => onChange(null)}>{t('removeBinding')}</button>}
    </div>
  </div>;
}
