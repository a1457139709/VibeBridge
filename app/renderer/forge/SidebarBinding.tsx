import { useId, useRef, useState, type ReactNode } from 'react';
import { useRequestResult } from '../common/effects/request';
import { useMainProcessEvents } from '../common/effects/subscription';
import { useLocalization } from '../common/Localization';
import type { ProjectView } from '../../shared/model';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import type { ShownRepositoryChoices } from '../../shared/forge/sidebar-data';
import { RepositoryList } from './RepositoryList';
import { errorMessage } from '../../shared/caught-error';
import './sidebar-binding.css';

function useShownRepositoryChoices({ id: projectId, directory, forge }: ProjectView) {
  const key = `${projectId} ${directory}`;
  const [shown, setShown] = useState<{ key: string; choices: ShownRepositoryChoices }>();
  useMainProcessEvents(event => {
    if (event.kind === 'repositoryChoices' && event.projectId === projectId) setShown({ key, choices: event.choices });
  });
  const show = () =>
    window.workbench.showRepositoryChoices(projectId).then(
      () => undefined,
      (error): RepositoryChoices => ({ ok: false, failure: { kind: 'transient', detail: errorMessage(error), forge } }),
    );
  const failedToShow = useRequestResult(key, show);
  const choices: ShownRepositoryChoices = (shown?.key === key ? shown.choices : failedToShow) ?? null;
  return {
    choices,
    listed: choices?.ok ? choices : undefined,
    retry: () => void show().then(failed => failed && setShown({ key, choices: failed })),
  };
}

function useBindingCall() {
  const { text } = useLocalization();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return {
    busy,
    error: error && (
      <p className="error-text" role="alert">
        {text(error)}
      </p>
    ),
    async run(call: () => Promise<void>, onSucceeded?: () => void) {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        await call();
        onSucceeded?.();
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
  };
}

function useFocusHandoff() {
  const pending = useRef(false);
  return {
    request() {
      pending.current = true;
    },
    ref(element: HTMLElement | null) {
      if (!element || !pending.current) return;
      pending.current = false;
      element.focus();
    },
  };
}

export function UnboundRepository({ project }: { project: ProjectView }) {
  const { t } = useLocalization();
  const { choices, listed, retry } = useShownRepositoryChoices(project);
  const [choosingOther, setChoosingOther] = useState(false);
  const [picked, setPicked] = useState<RepositoryReference>();
  const call = useBindingCall();
  const cardFocus = useFocusHandoff();
  const cardLabel = useId();
  const selection = listed ? (picked ?? listed.origin ?? null) : null;
  const bind = (repository: RepositoryReference) =>
    void call.run(() => window.workbench.bindRepository(project.id, repository));
  const origin = listed?.origin;
  if (!choices)
    return (
      <div className="binding-pane">
        <span className="muted">{t('loadingRepositories')}</span>
      </div>
    );
  if (origin && !choosingOther)
    return (
      <div className="binding-pane binding-card" role="group" aria-labelledby={cardLabel}>
        <p id={cardLabel}>{t('projectUnbound', { forge: project.forge.name })}</p>
        <div className="binding-origin">
          <span className="muted">{t('originPointsAt')}</span>
          <b className="repository-path">{origin.path}</b>
        </div>
        {call.error}
        <button className="primary" disabled={call.busy} onClick={() => bind(origin)}>
          {call.busy ? t('binding') : t('bindTo', { repository: origin.path })}
        </button>
        <button className="binding-link" ref={cardFocus.ref} onClick={() => setChoosingOther(true)}>
          {t('chooseOtherRepository')}
        </button>
      </div>
    );
  return (
    <div className="binding-pane">
      <b>{t('bindForgeRepository', { forge: project.forge.name })}</b>
      <p className="muted binding-hint">
        {listed && !origin ? t('originNotListed', { forge: project.forge.name }) : t('bindHint')}
      </p>
      {choosingOther && (
        <button
          className="binding-link"
          onClick={() => {
            cardFocus.request();
            setChoosingOther(false);
            setPicked(undefined);
          }}
        >
          {t('bindingBack')}
        </button>
      )}
      <RepositoryList
        choices={choices}
        retry={retry}
        boundRepository={null}
        selection={selection}
        pick={setPicked}
        disabled={call.busy}
        autoFocus={choosingOther}
      />
      {call.error}
      <div className="binding-actions">
        <button className="primary" disabled={!selection || call.busy} onClick={() => selection && bind(selection)}>
          {call.busy ? t('binding') : selection ? t('bindTo', { repository: selection.path }) : t('bind')}
        </button>
      </div>
    </div>
  );
}

export function ChangeBinding({
  project,
  back,
}: {
  project: ProjectView & { repository: RepositoryReference };
  back(): void;
}) {
  const { t } = useLocalization();
  const boundRepository = project.repository;
  const { choices, listed, retry } = useShownRepositoryChoices(project);
  const [picked, setPicked] = useState<RepositoryReference>();
  const [unbinding, setUnbinding] = useState(false);
  const call = useBindingCall();
  const unbindFocus = useFocusHandoff();
  const rebindTarget = listed && picked && !sameRepository(picked, boundRepository) ? picked : undefined;
  let consequence: ReactNode = null;
  const consequenceId = useId();
  const describedByConsequence = `${consequenceId}-what ${consequenceId}-impact`;
  const consequenceOf = (what: string, impact: string) => (
    <p className="binding-consequence">
      <span id={`${consequenceId}-what`}>{what}</span>
      <span id={`${consequenceId}-impact`}>{impact}</span>
    </p>
  );
  if (unbinding) consequence = consequenceOf(t('unbindConsequence'), t('unbindImpact'));
  else if (rebindTarget)
    consequence = consequenceOf(t('rebindConsequence', { repository: rebindTarget.path }), t('rebindImpact'));
  return (
    <div className="binding-pane">
      <button className="binding-link" onClick={back}>
        {t('bindingBack')}
      </button>
      <div className="binding-now">
        {t('currentBinding')}
        <b>{boundRepository.path}</b>
      </div>
      <RepositoryList
        choices={choices}
        retry={retry}
        boundRepository={boundRepository}
        selection={picked ?? null}
        pick={repository => {
          setPicked(repository);
          setUnbinding(false);
        }}
        disabled={call.busy}
        autoFocus
      />
      {consequence}
      {call.error}
      <div className="binding-actions">
        {unbinding ? (
          <>
            <span className="binding-spacer" />
            <button
              ref={unbindFocus.ref}
              disabled={call.busy}
              onClick={() => {
                unbindFocus.request();
                setUnbinding(false);
              }}
            >
              {t('cancel')}
            </button>
            <button
              className="danger"
              disabled={call.busy}
              aria-describedby={describedByConsequence}
              onClick={() => void call.run(() => window.workbench.unbindRepository(project.id), back)}
            >
              {call.busy ? t('changingBinding') : t('unbind')}
            </button>
          </>
        ) : (
          <>
            <button
              className="binding-link danger"
              ref={unbindFocus.ref}
              disabled={call.busy}
              onClick={() => {
                unbindFocus.request();
                setPicked(undefined);
                setUnbinding(true);
              }}
            >
              {t('unbind')}
            </button>
            <span className="binding-spacer" />
            <button
              className="primary"
              disabled={!rebindTarget || call.busy}
              aria-describedby={rebindTarget ? describedByConsequence : undefined}
              onClick={() =>
                rebindTarget && void call.run(() => window.workbench.bindRepository(project.id, rebindTarget), back)
              }
            >
              {call.busy
                ? t('changingBinding')
                : rebindTarget
                  ? t('rebindTo', { repository: rebindTarget.path })
                  : t('rebind')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
