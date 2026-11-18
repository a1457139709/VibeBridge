import { useEffect, useId, useState } from 'react';
import { useLocalization } from '../common/Localization';
import { detail } from '../../shared/messages';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import './repository-list.css';

export type LoadedChoices = RepositoryChoices | { ok: false; error: string };

/** The repositories the project can bind, with the one `origin` of `directory` points at; loaded when the project or
 * directory changes, and again on `retry`. Undefined while loading. */
export function useRepositoryChoices(projectId: string, directory: string) {
  const [choices, setChoices] = useState<LoadedChoices>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void window.workbench.repositoryChoices(projectId, directory).then(
      result => {
        if (live) setChoices(result);
      },
      error => {
        if (live) setChoices({ ok: false, error: (error as Error).message });
      },
    );
    return () => {
      live = false;
    };
  }, [projectId, directory, attempt]);
  return {
    choices,
    /** The loaded list, or undefined while loading or after a failure. */
    listed: choices?.ok ? choices : undefined,
    retry() {
      setChoices(undefined);
      setAttempt(value => value + 1);
    },
  };
}

interface Props {
  choices: LoadedChoices | undefined;
  retry(): void;
  /** The project's binding, marked current and kept in the list even when the account no longer lists it. */
  bound: RepositoryReference | null;
  selection: RepositoryReference | null;
  pick(repository: RepositoryReference): void;
  disabled?: boolean;
  /** Focuses the search box, or Retry, once it is drawn. */
  autoFocus?: boolean;
}

/** The account's repositories, searchable, with the one `origin` points at first; while loading, or when the list
 * cannot be read, its place says so and offers Retry. Focus stays in the search box, picking with the pointer too, and
 * there ↑/↓ move through the ones shown, without wrapping, keeping the one reached in view; Enter or Space picks it.
 * Pointing at one reaches it too, and a new search reaches none until a key moves. */
export function RepositoryList({ choices, retry, bound, selection, pick, disabled = false, autoFocus = false }: Props) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  /** The path of the repository the keys have reached. */
  const [reached, setReached] = useState<string>();
  const listId = useId();
  const optionId = (path: string) => `${listId}-${path}`;
  useEffect(() => {
    if (reached) document.getElementById(optionId(reached))?.scrollIntoView?.({ block: 'nearest' });
  }, [reached]);
  const retryButton = (
    <button type="button" autoFocus={autoFocus} onClick={retry}>
      {t('retry')}
    </button>
  );
  if (!choices) return <span className="muted">{t('loadingRepositories')}</span>;
  if (!choices.ok && 'error' in choices)
    return (
      <div className="repository-error">
        <span>{t('repositoryListFailed', { reason: detail(choices.error) })}</span>
        {retryButton}
      </div>
    );
  if (!choices.ok) {
    const { kind, detail: reason, forge } = choices.failure;
    return (
      <div className="repository-error">
        {kind === 'notInstalled' ? (
          <>
            <span>{t('forgeNotInstalled', { cli: forge.cli })}</span>
            <a href={forge.installUrl} target="_blank" rel="noreferrer">
              {t('installInstructions')}
            </a>
          </>
        ) : kind === 'loggedOut' ? (
          <span>{t('forgeLoggedOut', { cli: forge.cli, command: forge.loginCommand })}</span>
        ) : (
          <span>{t('repositoryListFailed', { reason: reason ? detail(reason) : kind })}</span>
        )}
        {retryButton}
      </div>
    );
  }
  const { origin } = choices;
  const listed =
    bound && !choices.repositories.some(item => sameRepository(item, bound))
      ? [bound, ...choices.repositories]
      : choices.repositories;
  const repositories = origin
    ? [...listed.filter(item => sameRepository(item, origin)), ...listed.filter(item => !sameRepository(item, origin))]
    : listed;
  const term = query.trim().toLowerCase();
  const shown = repositories.filter(item => item.path.toLowerCase().includes(term));
  const reachedIndex = shown.findIndex(item => item.path === reached);
  function keydown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown.length) return;
      const index =
        reachedIndex < 0
          ? 0
          : Math.max(0, Math.min(shown.length - 1, reachedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      setReached(shown[index].path);
    } else if ((event.key === 'Enter' || event.code === 'Space') && reachedIndex >= 0) pick(shown[reachedIndex]);
    else return;
    event.preventDefault();
  }
  return (
    <div className="repository-picker">
      <input
        type="search"
        aria-label={t('searchRepositories')}
        placeholder={t('searchRepositories')}
        autoComplete="off"
        autoFocus={autoFocus}
        value={query}
        disabled={disabled}
        aria-controls={listId}
        aria-activedescendant={reachedIndex >= 0 ? optionId(shown[reachedIndex].path) : undefined}
        onChange={event => {
          setQuery(event.target.value);
          setReached(undefined);
        }}
        onKeyDown={keydown}
      />
      {/* Pressing the list keeps focus in the search box, where its keys are answered. */}
      <div
        className="repository-list"
        id={listId}
        role="listbox"
        aria-label={t('repository')}
        onMouseDown={event => event.preventDefault()}
      >
        {shown.map(item => (
          <button
            type="button"
            role="option"
            key={item.path}
            id={optionId(item.path)}
            data-path={item.path}
            aria-selected={sameRepository(item, selection)}
            className={[sameRepository(item, selection) && 'on', item.path === reached && 'reached']
              .filter(Boolean)
              .join(' ')}
            disabled={disabled}
            tabIndex={-1}
            onMouseEnter={() => setReached(item.path)}
            onClick={() => pick(item)}
          >
            <span className="repository-path">{item.path}</span>
            {sameRepository(item, origin) && <small>{t('repositoryOrigin')}</small>}
            {sameRepository(item, bound) && <small>{t('repositoryCurrent')}</small>}
          </button>
        ))}
        {!shown.length && <span className="muted repository-empty">{t('noRepositories')}</span>}
      </div>
      <span className="muted repository-source">{t('repositoryListSource', { cli: choices.forge.cli })}</span>
    </div>
  );
}
