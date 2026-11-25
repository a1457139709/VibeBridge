import { useLocalization } from '../common/Localization';
import { agentIcons } from '../common/agent-icons';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  agentNames,
  agentTypes,
  arrange,
  assignedAgents,
  type DefaultLayout,
  type LaunchResult,
  type ProjectDraft,
} from '../../shared/model';
import { LaunchResults } from './LaunchResults';
import { layoutBoxes } from '../../shared/layout';
import { projectNameFromDirectory, projectNameMessage, projectNameProblem } from '../../shared/project-name';
import { presentDirectoryField } from './directory-field';
import { useInspectedDirectory, usePastedNameProblem } from './project-form';
import { directoryProblemMessage } from '../../shared/directory-problem';
import { errorMessage } from '../../shared/caught-error';
import { requireValue } from '../common/required';

function Stepper({
  label,
  value,
  decrease,
  increase,
  canDecrease,
  canIncrease,
}: {
  label: string;
  value: number;
  decrease(): void;
  increase(): void;
  canDecrease: boolean;
  canIncrease: boolean;
}) {
  const { t } = useLocalization();
  return (
    <div className="stepper">
      <button type="button" aria-label={t('decrease', { label })} disabled={!canDecrease} onClick={decrease}>
        −
      </button>
      <output>{value}</output>
      <button type="button" aria-label={t('increase', { label })} disabled={!canIncrease} onClick={increase}>
        ＋
      </button>
    </div>
  );
}
export function Setup({
  draft,
  changeDraft,
  cancel,
  onSetupFinished,
  openProject,
  report,
  openAgentSettings,
  defaultLayout,
}: {
  draft: ProjectDraft;
  changeDraft: Dispatch<SetStateAction<ProjectDraft>>;
  cancel(): void;
  onSetupFinished(id: string): void;
  openProject(id: string): void;
  report(message: string): void;
  openAgentSettings(): void;
  defaultLayout: DefaultLayout;
}) {
  const { t, translate } = useLocalization();
  const checked = useInspectedDirectory(draft.directory, report);
  const [nameTouched, setNameTouched] = useState(false);
  const [directoryTouched, setDirectoryTouched] = useState(false);
  const pastedName = usePastedNameProblem();
  const pastedNameProblem = pastedName.problem;
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launchReport, setLaunchReport] = useState<{ projectId: string; launches: LaunchResult[] }>();
  const pending = useRef(false);
  const directoryField = presentDirectoryField({ input: draft.directory, touched: directoryTouched, checked });
  const duplicate = directoryField.problem?.kind === 'duplicate' ? directoryField.problem : undefined;
  const nameProblem = projectNameProblem(draft.name);
  const shownNameProblem = pastedNameProblem ?? (nameTouched || draft.name.trim() ? nameProblem : null);
  const nameMessage = shownNameProblem ? translate(projectNameMessage(shownNameProblem)) : '';
  const directoryMessage = directoryField.problem
    ? translate(directoryProblemMessage(directoryField.problem, 'create'))
    : '';
  const assigned = agentTypes.reduce((sum, type) => sum + draft.counts[type], 0);
  const canCreate =
    !busy && !choosing && directoryField.canSave && !nameProblem && !pastedNameProblem && assigned === draft.total;
  async function chooseDirectory() {
    setChoosing(true);
    try {
      const path = await window.workbench.chooseDirectory();
      if (path === null) return;
      changeDraft(current => ({
        ...current,
        directory: path,
        name: current.name.trim() ? current.name : projectNameFromDirectory(path),
      }));
      pastedName.clear();
      setNameTouched(true);
      setDirectoryTouched(true);
    } catch (error) {
      report(errorMessage(error));
    } finally {
      setChoosing(false);
    }
  }
  const types = assignedAgents(draft);
  const preview = Array.from({ length: Math.max(draft.total, assigned) }, (_, index) => String(index));
  const boxes = layoutBoxes(arrange(preview, defaultLayout)).panels;
  async function submit() {
    if (pending.current) return;
    if (!canCreate) {
      setNameTouched(true);
      setDirectoryTouched(true);
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const { project, launches } = await window.workbench.createProject(draft);
      if (launches.every(launch => launch.outcome === 'started')) onSetupFinished(project.id);
      else setLaunchReport({ projectId: project.id, launches });
    } catch (error) {
      report(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (launchReport) {
    const failed = launchReport.launches.some(launch => launch.outcome === 'failed');
    return (
      <div className="setup-scroll">
        <section className="setup">
          <h1>{t('createProject')}</h1>
          {failed && <p role="status">{t('setupLaunchFailed')}</p>}
          <LaunchResults launches={launchReport.launches} />
          <div className="setup-actions">
            {failed && (
              <button
                type="button"
                onClick={() => {
                  onSetupFinished(launchReport.projectId);
                  openAgentSettings();
                }}
              >
                {t('openAgentSettings')}
              </button>
            )}
            <button type="button" className="primary" autoFocus onClick={() => onSetupFinished(launchReport.projectId)}>
              {t('finish')}
            </button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="setup-scroll">
      <form
        className="setup"
        onSubmit={event => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1>{t('createProject')}</h1>
        <p className="muted intro">{t('setupIntro')}</p>
        <label htmlFor="project-name">{t('projectName')}</label>
        <input
          id="project-name"
          value={draft.name}
          aria-invalid={!!nameMessage}
          aria-describedby="project-name-status"
          onBlur={() => setNameTouched(true)}
          onChange={event => {
            pastedName.clear();
            changeDraft({ ...draft, name: event.target.value });
          }}
          onPaste={pastedName.checkPaste}
          autoComplete="off"
        />
        <div id="project-name-status" className="field-status" hidden={!nameMessage} aria-live="polite">
          {nameMessage && <span className="error-text">{nameMessage}</span>}
        </div>
        <label htmlFor="project-directory">{t('localDirectory')}</label>
        <div className="directory-input">
          <input
            id="project-directory"
            value={draft.directory}
            aria-invalid={!!directoryMessage}
            aria-describedby="project-directory-status"
            onBlur={() => setDirectoryTouched(true)}
            onChange={event => changeDraft({ ...draft, directory: event.target.value })}
            placeholder="/Users/you/Projects/my-project"
            autoComplete="off"
          />
          <button
            type="button"
            aria-label={t('chooseDirectory')}
            disabled={choosing}
            onClick={() => void chooseDirectory()}
          >
            {t('browse')}
          </button>
        </div>
        <div
          id="project-directory-status"
          className="directory-status field-status"
          hidden={!directoryField.checking && !directoryMessage}
          aria-live="polite"
        >
          {directoryField.checking
            ? t('checkingDirectory')
            : directoryMessage && <span className="error-text">{directoryMessage}</span>}
          {duplicate && (
            <button type="button" className="open-existing-project" onClick={() => openProject(duplicate.projectId)}>
              {t('openExisting')}
            </button>
          )}
        </div>
        <hr />
        <label>{t('layoutPreview')}</label>
        <div
          className="preview"
          style={{ height: Math.max(264, Math.ceil(preview.length / 2) * 72) }}
          aria-label={t('readOnlyPreview')}
        >
          {preview.map((id, index) => {
            const box = requireValue(boxes.get(id), `preview panel ${id}`);
            const type = types[index];
            const position = {
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            };
            return (
              <div className={`preview-panel ${type || ''}`} key={id} style={position}>
                <span className="agent-mark">{type ? agentIcons[type] : '＋'}</span>
                <span>{type ? agentNames[type] : t('unassigned')}</span>
                <small>{index + 1}</small>
              </div>
            );
          })}
        </div>
        <div className="quantity-row">
          <span>{t('windowCount')}</span>
          <Stepper
            label={t('windowCount')}
            value={draft.total}
            decrease={() => changeDraft({ ...draft, total: draft.total - 1 })}
            increase={() => changeDraft({ ...draft, total: draft.total + 1 })}
            canDecrease={draft.total > 1}
            canIncrease={draft.total < 10}
          />
        </div>
        <label id="allocation-label" className="allocation-label">
          {t('assignAgents')}
        </label>
        {agentTypes.map(type => (
          <div className={`quantity-row ${type}`} key={type}>
            <span>
              <span className="agent-mark">{agentIcons[type]}</span>
              {agentNames[type]}
            </span>
            <Stepper
              label={agentNames[type]}
              value={draft.counts[type]}
              decrease={() => changeDraft({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] - 1 } })}
              increase={() => changeDraft({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] + 1 } })}
              canDecrease={draft.counts[type] > 0}
              canIncrease={assigned < draft.total}
            />
          </div>
        ))}
        <div className="allocation-status" role="status" aria-labelledby="allocation-label">
          <span>{t('assigned', { count: assigned, total: draft.total })}</span>
          <span className={assigned > draft.total ? 'error-text' : 'muted'}>
            {assigned < draft.total
              ? t('assignRemaining', { count: draft.total - assigned })
              : assigned > draft.total
                ? t('assignExcess', { count: assigned - draft.total })
                : t('assignmentComplete')}
          </span>
        </div>
        <div className="setup-actions">
          <button type="button" onClick={cancel} disabled={busy}>
            {t('cancel')}
          </button>
          <button className="primary" type="submit" disabled={!canCreate}>
            {busy ? t('creating') : t('createAndStart')}
          </button>
        </div>
      </form>
    </div>
  );
}
