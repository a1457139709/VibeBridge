import { useId, useState } from 'react';
import { useLocalization } from '../common/Localization';
import { nestedMessage } from '../../shared/messages';
import { sameRepository, type RepositoryReference } from '../../shared/forge/forge';
import type { ShownRepositoryChoices } from '../../shared/forge/sidebar-data';
import './repository-list.css';

interface Props {
  choices: ShownRepositoryChoices;
  retry(): void;
  boundRepository: RepositoryReference | null;
  selection: RepositoryReference | null;
  pick(repository: RepositoryReference): void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function RepositoryList({
  choices,
  retry,
  boundRepository,
  selection,
  pick,
  disabled = false,
  autoFocus = false,
}: Props) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const [highlightedPath, setHighlightedPath] = useState<string>();
  const listId = useId();
  const optionId = (path: string) => `${listId}-${path}`;
  const retryButton = (
    <button type="button" autoFocus={autoFocus} onClick={retry}>
      {t('retry')}
    </button>
  );
  if (!choices) return <span className="muted">{t('loadingRepositories')}</span>;
  if (!choices.ok) {
    const { failure } = choices;
    const reason = failure.detail ? nestedMessage(failure.detail) : failure.kind;
    return (
      <div className="repository-error">
        {failure.kind === 'notInstalled' ? (
          <>
            <span role="alert">{t('forgeNotInstalled', { cli: failure.forge.cli })}</span>
            <a href={failure.forge.installUrl} target="_blank" rel="noreferrer">
              {t('installInstructions')}
            </a>
          </>
        ) : failure.kind === 'loggedOut' ? (
          <span role="alert">
            {t('forgeLoggedOut', { cli: failure.forge.cli, command: failure.forge.loginCommand })}
          </span>
        ) : (
          <span role="alert">{t('repositoryListFailed', { reason })}</span>
        )}
        {retryButton}
      </div>
    );
  }
  const { origin } = choices;
  const listed =
    boundRepository && !choices.repositories.some(item => sameRepository(item, boundRepository))
      ? [boundRepository, ...choices.repositories]
      : choices.repositories;
  const repositories = origin
    ? [...listed.filter(item => sameRepository(item, origin)), ...listed.filter(item => !sameRepository(item, origin))]
    : listed;
  const term = query.trim().toLowerCase();
  const shown = repositories.filter(item => item.path.toLowerCase().includes(term));
  const reachedIndex = shown.findIndex(item => item.path === highlightedPath);
  function keydown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown.length) return;
      const index =
        reachedIndex < 0
          ? 0
          : Math.max(0, Math.min(shown.length - 1, reachedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      const reached = shown[index].path;
      setHighlightedPath(reached);
      document.getElementById(optionId(reached))?.scrollIntoView?.({ block: 'nearest' });
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
          setHighlightedPath(undefined);
        }}
        onKeyDown={keydown}
      />
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
            aria-labelledby={`${optionId(item.path)}-path`}
            aria-describedby={`${optionId(item.path)}-origin ${optionId(item.path)}-current`}
            data-path={item.path}
            aria-selected={sameRepository(item, selection)}
            className={[sameRepository(item, selection) && 'on', item.path === highlightedPath && 'reached']
              .filter(Boolean)
              .join(' ')}
            disabled={disabled}
            tabIndex={-1}
            onMouseEnter={() => setHighlightedPath(item.path)}
            onClick={() => pick(item)}
          >
            <span className="repository-path" id={`${optionId(item.path)}-path`}>
              {item.path}
            </span>
            {sameRepository(item, origin) && (
              <small id={`${optionId(item.path)}-origin`}>{t('repositoryOrigin')}</small>
            )}
            {sameRepository(item, boundRepository) && (
              <small id={`${optionId(item.path)}-current`}>{t('repositoryCurrent')}</small>
            )}
          </button>
        ))}
        {!shown.length && <span className="muted repository-empty">{t('noRepositories')}</span>}
      </div>
      <span className="muted repository-source">{t('repositoryListSource', { cli: choices.forge.cli })}</span>
    </div>
  );
}
