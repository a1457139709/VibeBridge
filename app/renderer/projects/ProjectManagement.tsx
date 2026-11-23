import { useLocalization } from '../common/Localization';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { type Project, type ProjectEditResult, type ProjectView } from '../../shared/model';
import { originElsewhereThanBinding, type RepositoryChoices } from '../../shared/forge/forge';
import {
  projectNameHasControls,
  projectNameMessage,
  projectNameProblem,
  type ProjectNameProblem,
} from '../../shared/project-name';
import { presentDirectoryField, type DirectoryCheck } from './directory-field';
import { directoryProblemMessage } from '../../shared/directory-problem';
import { LaunchResults } from './LaunchResults';
import { errorMessage } from '../../shared/caught-error';
import { requireValue } from '../common/required';
import './project-management.css';

export function ProjectNavigationItem({
  project,
  openProject,
  openBinding,
  children,
}: {
  project: ProjectView;
  openProject(id: string): void;
  openBinding(project: ProjectView): void;
  children: ReactNode;
}) {
  const { t } = useLocalization();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [action, setAction] = useState<'edit' | 'delete'>();
  const menuElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node && menuElement.current?.contains(event.target))) setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(undefined);
      }
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const showMenu = (x: number, y: number) =>
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 168)),
      y: Math.max(8, Math.min(y, window.innerHeight - 92)),
    });
  return (
    <div
      className="project-row"
      onContextMenu={event => {
        event.preventDefault();
        showMenu(event.clientX, event.clientY);
      }}
    >
      {children}
      <button
        className="project-menu-trigger"
        aria-label={t('projectMenu', { name: project.name })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={event => {
          const box = event.currentTarget.getBoundingClientRect();
          showMenu(box.left, box.bottom);
        }}
      >
        ⋯
      </button>
      {menu && (
        <div className="project-menu" ref={menuElement} role="menu" style={{ left: menu.x, top: menu.y }}>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(undefined);
              setAction('edit');
            }}
          >
            {t('editProject')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(undefined);
              setAction('delete');
            }}
          >
            {t('deleteProject')}
          </button>
        </div>
      )}
      {action === 'edit' && (
        <ProjectEditor
          project={project}
          close={() => setAction(undefined)}
          openProject={id => {
            setAction(undefined);
            openProject(id);
          }}
          openBinding={() => {
            setAction(undefined);
            openBinding(project);
          }}
        />
      )}
      {action === 'delete' && <DeleteProject project={project} close={() => setAction(undefined)} />}
    </div>
  );
}

function useListedForDirectory(projectId: string, directory: string | null) {
  const [listed, setListed] = useState<Extract<RepositoryChoices, { ok: true }>>();
  useEffect(() => {
    setListed(undefined);
    if (directory === null) return;
    let live = true;
    void window.workbench.fetchRepositoryChoices(projectId, directory).then(
      choices => {
        if (live && choices.ok) setListed(choices);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId, directory]);
  return listed;
}

export function ProjectEditor({
  project,
  close,
  openProject,
  openBinding,
}: {
  project: ProjectView;
  close(): void;
  openProject(id: string): void;
  openBinding(): void;
}) {
  const { t, text, translate } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [original] = useState(project);
  const running = project.panels.filter(panel => panel.run?.state === 'running').length;
  const [name, setName] = useState(project.name),
    [directoryInput, setDirectoryInput] = useState(project.directory);
  const [checked, setChecked] = useState<{ input: string; check: DirectoryCheck }>();
  const [pastedNameProblem, setPastedNameProblem] = useState<ProjectNameProblem | null>(null);
  const [busy, setBusy] = useState(false),
    [choosing, setChoosing] = useState(false),
    [error, setError] = useState('');
  const [result, setResult] = useState<ProjectEditResult>();
  const repositoryPath = useId();
  const boundRepository = project.repository;
  const directoryField = presentDirectoryField({
    input: directoryInput,
    touched: true,
    checked,
    editing: { projectId: project.id, directory: original.directory },
  });
  const duplicate = directoryField.problem?.kind === 'duplicate' ? directoryField.problem : undefined;
  const nameProblem = pastedNameProblem ?? projectNameProblem(name);
  const nameError = nameProblem ? translate(projectNameMessage(nameProblem)) : '';
  const directoryError = directoryField.problem
    ? translate(directoryProblemMessage(directoryField.problem, 'edit'))
    : '';
  const changedDirectory = directoryField.changed;
  const edited = name.trim() !== original.name || directoryInput !== original.directory;
  const listed = useListedForDirectory(
    project.id,
    boundRepository && directoryField.changed ? directoryField.directory : null,
  );
  const originElsewhere = originElsewhereThanBinding(boundRepository, listed);
  const canSave = !busy && !choosing && directoryField.canSave && !nameProblem;
  useLayoutEffect(() => {
    const element = requireValue(dialog.current, 'the edit project dialog');
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let live = true;
    if (!directoryInput) return;
    const timer = setTimeout(() => {
      void window.workbench
        .inspectDirectory(directoryInput)
        .then(check => {
          if (live) setChecked({ input: directoryInput, check });
        })
        .catch(error => {
          if (live) {
            setChecked({ input: directoryInput, check: { ok: false, problem: { kind: 'checkFailed' } } });
            setError(errorMessage(error));
          }
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [directoryInput]);
  async function save(restart: boolean) {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const outcome = await window.workbench.editProject(project.id, { name, directory: directoryInput }, restart);
      if (outcome.error || outcome.launches.length) setResult(outcome);
      else close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog"
      aria-label={t('editProject')}
      onCancel={event => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2>{result ? t('projectEditResult') : t('editProject')}</h2>
      {result ? (
        <>
          <p role="status">{t('projectSaved', { name: result.project.name })}</p>
          <p className="project-path">{result.project.directory}</p>
          {result.error && (
            <p className="error-text" role="alert">
              {text(result.error)}
            </p>
          )}
          {!!result.launches.length && (
            <>
              <p>
                {result.launches.every(launch => launch.outcome === 'started')
                  ? t('panelsRestarted')
                  : t('panelsRestartUnconfirmed')}
              </p>
              <LaunchResults launches={result.launches} />
            </>
          )}
          <div className="project-dialog-actions">
            <button className="primary" onClick={close}>
              {t('finish')}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!changedDirectory && edited) void save(false);
          }}
        >
          <label htmlFor="edit-project-name">{t('projectName')}</label>
          <input
            id="edit-project-name"
            autoFocus
            autoComplete="off"
            value={name}
            disabled={busy}
            aria-invalid={!!nameError}
            aria-describedby="edit-project-name-status"
            onChange={event => {
              setPastedNameProblem(null);
              setName(event.target.value);
            }}
            onPaste={event => {
              if (projectNameHasControls(event.clipboardData.getData('text'))) {
                event.preventDefault();
                setPastedNameProblem({ kind: 'controls' });
              } else setPastedNameProblem(null);
            }}
          />
          {nameError && (
            <div id="edit-project-name-status" className="field-status error-text">
              {nameError}
            </div>
          )}
          <label htmlFor="edit-project-directory">{t('localDirectory')}</label>
          <div className="directory-input">
            <input
              id="edit-project-directory"
              autoComplete="off"
              value={directoryInput}
              disabled={busy}
              aria-invalid={!!directoryError}
              aria-describedby="edit-project-directory-status"
              onChange={event => setDirectoryInput(event.target.value)}
            />
            <button
              type="button"
              disabled={busy || choosing}
              aria-label={t('chooseNewDirectory')}
              onClick={async () => {
                setChoosing(true);
                try {
                  const selected = await window.workbench.chooseDirectory();
                  if (selected !== null) setDirectoryInput(selected);
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setChoosing(false);
                }
              }}
            >
              {t('browse')}
            </button>
          </div>
          {(directoryField.checking || directoryError) && (
            <div id="edit-project-directory-status" className="field-status" aria-live="polite">
              {directoryField.checking ? t('checkingDirectory') : <span className="error-text">{directoryError}</span>}
              {duplicate && (
                <button
                  type="button"
                  className="open-existing-project"
                  onClick={() => openProject(duplicate.projectId)}
                >
                  {t('openExisting')}
                </button>
              )}
            </div>
          )}
          <div className="repository-field">
            <span className="repository-label">{t('repository')}</span>
            <div className="repository-current">
              <span className="repository-path" id={repositoryPath}>
                {boundRepository ? <b>{boundRepository.path}</b> : t('notBound')}
              </span>
              <span className="repository-current-actions">
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={openBinding}
                  aria-describedby={repositoryPath}
                >
                  {t(boundRepository ? 'changeBindingInSidebar' : 'bindInSidebar', { forge: project.forge.name })}
                </button>
              </span>
            </div>
          </div>
          {changedDirectory && (
            <section className="save-impact" aria-label={t('afterSave')}>
              <b>{t('afterSave')}</b>
              <dl>
                <dt>{t('directory')}</dt>
                <dd>
                  <span className="project-path">
                    {original.directory} → {directoryField.directory}
                  </span>
                  <p>{t('currentRuns', { count: running })}</p>
                  <p>
                    <strong>{t('changeAndRestart')}: </strong>
                    {t('restartImpact')}
                  </p>
                  <p>
                    <strong>{t('changeWithoutRestart')}: </strong>
                    {t('noRestartImpact')}
                  </p>
                  <p>{t('directoryHistory')}</p>
                </dd>
                {originElsewhere && boundRepository && (
                  <>
                    <dt>{t('repository')}</dt>
                    <dd>
                      <p>
                        {t('originElsewhereThanBinding', {
                          origin: originElsewhere.path,
                          repository: boundRepository.path,
                        })}
                      </p>
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}
          {error && (
            <p className="error-text" role="alert">
              {text(error)}
            </p>
          )}
          <div className="project-dialog-actions">
            <button type="button" disabled={busy} onClick={close}>
              {changedDirectory ? t('cancelChange') : t('cancel')}
            </button>
            {changedDirectory ? (
              <>
                <button type="button" disabled={!canSave} onClick={() => void save(false)}>
                  {t('changeWithoutRestart')}
                </button>
                <button className="primary" type="button" disabled={!canSave} onClick={() => void save(true)}>
                  {busy ? t('processing') : t('changeAndRestart')}
                </button>
              </>
            ) : (
              <button type="submit" className="primary" disabled={!canSave || !edited}>
                {busy ? t('saving') : t('saveChanges')}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}

function DeleteProject({ project, close }: { project: Project; close(): void }) {
  const { t, text } = useLocalization();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const element = requireValue(dialog.current, 'the delete project dialog');
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="project-dialog delete-project-dialog"
      aria-label={t('deleteProject')}
      onCancel={event => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2>{t('deleteProjectQuestion', { name: project.name })}</h2>
      <p>{t('deleteProjectImpact')}</p>
      <p>{t('deleteProjectHistory')}</p>
      {error && (
        <p className="error-text" role="alert">
          {text(error)}
        </p>
      )}
      <div className="project-dialog-actions">
        <button autoFocus disabled={busy} onClick={close}>
          {t('cancel')}
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await window.workbench.deleteProject(project.id);
              close();
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('deleting') : t('confirmDelete')}
        </button>
      </div>
    </dialog>
  );
}
