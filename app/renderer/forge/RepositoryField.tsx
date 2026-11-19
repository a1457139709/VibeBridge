import { useState, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { ProjectView } from '../../shared/model';
import { sameRepository, type RepositoryReference } from '../../shared/forge/forge';
import { RepositoryList, useRepositoryChoices } from './RepositoryList';
import '../projects/project-management.css';

/** The repository field's form state. The choices load when the dialog opens and follow the directory being
 * edited; `repository` is the binding the project has after saving. A list that failed to load binds nothing new. */
export function useRepositoryField(project: ProjectView, directory: string) {
  const bound = project.repository;
  const { choices, listed, retry } = useRepositoryChoices(project.id, directory);
  const [changing, setChanging] = useState(false),
    [unbinding, setUnbinding] = useState(false);
  // undefined follows the default: the bound repository, else the one origin points at.
  const [picked, setPicked] = useState<RepositoryReference | null>();
  const selection = picked !== undefined ? picked : (bound ?? listed?.origin ?? null);
  const repository = bound
    ? unbinding
      ? null
      : changing && listed && selection
        ? selection
        : bound
    : listed
      ? selection
      : null;
  return {
    bound,
    choices,
    listed,
    selection,
    repository,
    changing,
    unbinding,
    retry,
    pick: setPicked,
    change() {
      setChanging(true);
    },
    unbind() {
      setUnbinding(true);
    },
    undo() {
      setChanging(false);
      setUnbinding(false);
      setPicked(undefined);
    },
  };
}
type RepositoryFieldState = ReturnType<typeof useRepositoryField>;

/** Bound: the repository with 更换 and 解绑, and the list only after 更换. Unbound: the list, with what saving binds. */
export function RepositoryField({ field, disabled }: { field: RepositoryFieldState; disabled: boolean }) {
  const { t } = useLocalization();
  const { bound, repository } = field;
  const changed = !sameRepository(repository, bound);
  let summary: ReactNode;
  if (bound)
    summary = (
      <>
        <span className="repository-path">
          <b>{bound.path}</b>
          {changed ? (
            <>
              {' '}
              → <b>{repository?.path ?? t('doNotBind')}</b>
            </>
          ) : (
            <small> {t('repositoryCurrent')}</small>
          )}
        </span>
        <span className="repository-current-actions">
          {field.changing || field.unbinding ? (
            <button type="button" disabled={disabled} onClick={field.undo}>
              {t('undo')}
            </button>
          ) : (
            <>
              <button type="button" disabled={disabled} onClick={field.change}>
                {t('changeRepository')}
              </button>
              <button type="button" className="danger" disabled={disabled} onClick={field.unbind}>
                {t('unbind')}
              </button>
            </>
          )}
        </span>
      </>
    );
  else
    summary = (
      <>
        <span className="repository-path">
          {repository ? t('bindAfterSave', { repository: repository.path }) : t('notBound')}
        </span>
        {repository && (
          <span className="repository-current-actions">
            <button type="button" disabled={disabled} onClick={() => field.pick(null)}>
              {t('doNotBind')}
            </button>
          </span>
        )}
      </>
    );
  const listShown = bound ? field.changing : true;
  return (
    <div className="repository-field">
      <span id="edit-project-repository" className="repository-label">
        {t('repository')}
      </span>
      <div className={`repository-current${changed ? ' changed' : ''}`}>{summary}</div>
      {listShown && (
        <RepositoryList
          choices={field.choices}
          retry={field.retry}
          bound={bound}
          selection={field.selection}
          pick={field.pick}
          disabled={disabled}
          autoFocus={field.changing}
        />
      )}
    </div>
  );
}

/** The binding change in the "After saving" list of a dialog that saves the field, when a bound project's changes. */
export function BindingImpact({ field }: { field: RepositoryFieldState }) {
  const { t } = useLocalization();
  const { bound, repository } = field;
  if (!bound || sameRepository(repository, bound)) return null;
  return (
    <>
      <dt>{t('repository')}</dt>
      <dd>
        <span className="project-path">
          {bound.path} → {repository?.path ?? t('doNotBind')}
        </span>
        <p>{repository ? t('rebindImpact') : t('unbindImpact')}</p>
      </dd>
    </>
  );
}
