import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { ProjectView } from '../../shared/model';
import { sameRepository, type RepositoryReference } from '../../shared/forge/forge';
import type { ShownRepositoryChoices } from '../../shared/forge/sidebar-data';
import { RepositoryList } from './RepositoryList';
import './sidebar-binding.css';

/** The repositories the project can bind, as the main process pushes them once this page declares it shows them;
 * null while they are being read. The page declares it again when the project moves to another directory, whose
 * `origin` may point elsewhere, and on Retry; each declaration reads them again. */
function useShownRepositoryChoices({ id: projectId, directory, forge }: ProjectView) {
  const [choices, setChoices] = useState<ShownRepositoryChoices>(null);
  // A declaration the main process refuses shows its reason in the list's place, with Retry, like a transient failure.
  const show = () =>
    void window.workbench
      .showRepositoryChoices(projectId)
      .catch((error: Error) => setChoices({ ok: false, failure: { kind: 'transient', detail: error.message, forge } }));
  useEffect(() => {
    setChoices(null);
    const stop = window.workbench.subscribe(event => {
      if (event.kind === 'repositoryChoices' && event.projectId === projectId) setChoices(event.choices);
    });
    show();
    return stop;
  }, [projectId, directory]);
  return {
    choices,
    /** The loaded list, or undefined while loading or after a failure. */
    listed: choices?.ok ? choices : undefined,
    retry: show,
  };
}

/** A binding call from a button: whether one is running, and the reason the last one failed, shown where it was made. */
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
    /** Runs `call`, then `onSucceeded`; a failure stays shown until the next call. */
    async run(call: () => Promise<void>, onSucceeded?: () => void) {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        await call();
        onSucceeded?.();
      } catch (failure) {
        setError((failure as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Focus for a control drawn in place of the one just pressed, which unmounts with it: call `request` before the
 * swap and put `ref` on the control that takes over. */
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

/** An unbound project's sidebar body. When `origin` of its directory points at a listed repository, a card offers to
 * bind that one, and Choose another repository… opens the list with that one picked; otherwise the list shows with nothing picked. Each
 * Bind button binds at once; the sidebar then shows the bound repository's lists. */
export function UnboundRepository({ project }: { project: ProjectView }) {
  const { t } = useLocalization();
  const { choices, listed, retry } = useShownRepositoryChoices(project);
  /** Whether Choose another repository… turned the origin card into the list. */
  const [choosingOther, setChoosingOther] = useState(false);
  const [picked, setPicked] = useState<RepositoryReference>();
  const call = useBindingCall();
  const backToCard = useFocusHandoff();
  // A list that failed to load offers nothing to bind, whatever was picked before.
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
      <div className="binding-pane binding-card">
        <p>{t('projectUnbound', { forge: project.forge.name })}</p>
        <div className="binding-origin">
          <span className="muted">{t('originPointsAt')}</span>
          <b className="repository-path">{origin.path}</b>
        </div>
        {call.error}
        <button className="primary" disabled={call.busy} onClick={() => bind(origin)}>
          {call.busy ? t('binding') : t('bindTo', { repository: origin.path })}
        </button>
        <button className="binding-link" ref={backToCard.ref} onClick={() => setChoosingOther(true)}>
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
            backToCard.request();
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
        bound={null}
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

/** A bound project's change-binding page. Picking another repository states what rebinding does above Rebind to Y;
 * Unbind states what unbinding does first, and its own Unbind carries it out. Unbinding reads no list, so it works when
 * the list cannot be read. `back` returns to the lists, as each change does once it went through. */
export function ChangeBinding({
  project,
  back,
}: {
  project: ProjectView & { repository: RepositoryReference };
  back(): void;
}) {
  const { t } = useLocalization();
  const bound = project.repository;
  const { choices, listed, retry } = useShownRepositoryChoices(project);
  const [picked, setPicked] = useState<RepositoryReference>();
  const [unbinding, setUnbinding] = useState(false);
  const call = useBindingCall();
  const toggleUnbinding = useFocusHandoff();
  const rebindTarget = listed && picked && !sameRepository(picked, bound) ? picked : undefined;
  let consequence: ReactNode = null;
  if (unbinding)
    consequence = (
      <p className="binding-consequence">
        {t('unbindConsequence')}
        {t('unbindImpact')}
      </p>
    );
  else if (rebindTarget)
    consequence = (
      <p className="binding-consequence">
        {t('rebindConsequence', { repository: rebindTarget.path })}
        {t('rebindImpact')}
      </p>
    );
  return (
    <div className="binding-pane">
      <button className="binding-link" onClick={back}>
        {t('bindingBack')}
      </button>
      <div className="binding-now">
        {t('currentBinding')}
        <b>{bound.path}</b>
      </div>
      <RepositoryList
        choices={choices}
        retry={retry}
        bound={bound}
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
              ref={toggleUnbinding.ref}
              disabled={call.busy}
              onClick={() => {
                toggleUnbinding.request();
                setUnbinding(false);
              }}
            >
              {t('cancel')}
            </button>
            <button
              className="danger"
              disabled={call.busy}
              onClick={() => void call.run(() => window.workbench.unbindRepository(project.id), back)}
            >
              {call.busy ? t('changingBinding') : t('unbind')}
            </button>
          </>
        ) : (
          <>
            <button
              className="binding-link danger"
              ref={toggleUnbinding.ref}
              disabled={call.busy}
              onClick={() => {
                toggleUnbinding.request();
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
