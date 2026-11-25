import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocalization } from '../common/Localization';
import { nestedMessage } from '../../shared/messages';
import type {
  DirectAction,
  DirectActionResult,
  ForgeFailure,
  ForgeLinks,
  IssueDetail,
  RepositoryReference,
} from '../../shared/forge/forge';
import type { DetailItem, ShownDetail } from '../../shared/forge/sidebar-data';
import type { ProjectView } from '../../shared/model';
import { linkedItem } from './ForgeDisplay';
import { idleActions, type Actions, type ActionState } from './DirectActions';
import { IssueDocument, type IssueDispatch } from './IssueDetail';
import { PullRequestDocument } from './PullRequestDetail';
import { StaleNotice } from './StaleNotice';
import { withoutShortcutModifier } from '../../shared/settings/shortcuts';
import { errorMessage } from '../../shared/caught-error';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  item: DetailItem;
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  canBack: boolean;
  back(): void;
  close(): void;
  open(item: DetailItem): void;
  retry(): void;
  reportChanged(item: DetailItem): void;
  showForgeFailure(failure: ForgeFailure): void;
  issueDispatch(issue: IssueDetail): IssueDispatch;
}

const kindText = {
  issue: { region: 'issueDetail', crumb: 'issueCrumb' },
  pullRequest: { region: 'pullRequestDetail', crumb: 'pullRequestCrumb' },
} as const;

export function ForgeDetailPane({
  project,
  item,
  resize,
  canBack,
  back,
  close,
  open,
  retry,
  reportChanged,
  showForgeFailure,
  issueDispatch,
}: Props) {
  const { t, text } = useLocalization();
  const [loaded, setLoaded] = useState<ShownDetail | null>(null);
  const [actionState, setActionState] = useState<ActionState>(idleActions);
  useEffect(
    () =>
      window.workbench.subscribe(event => {
        if (event.kind !== 'forgeDetail' || event.projectId !== project.id) return;
        setLoaded(event.detail);
        setActionState(idleActions);
      }),
    [project.id],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const { kind, number } = item;
  const shownItem = useRef(item);
  shownItem.current = item;
  useLayoutEffect(() => {
    scroller.current?.focus({ preventScroll: true });
    scroller.current?.scrollTo?.({ top: 0 });
  }, [kind, number]);
  const keydown = (event: React.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      (event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]'))
    )
      return;
    if (event.key === 'Escape' || (event.key === 'ArrowRight' && withoutShortcutModifier(event))) {
      event.preventDefault();
      close();
    }
  };
  const forItem = loaded?.item.kind === kind && loaded.item.number === number ? loaded : null;
  const result = forItem?.result ?? null;
  const stale = forItem?.failed ?? null;
  const loadedItem = result?.ok ? ('issue' in result ? result.issue : result.pullRequest) : null;
  const perform = async (action: DirectAction) => {
    setActionState({ performing: action, failed: null });
    let result: DirectActionResult;
    try {
      result = await window.workbench.performDirectAction(project.id, action);
    } catch (error) {
      result = {
        ok: false,
        failure: { kind: 'transient', detail: text(errorMessage(error)), forge: project.forge },
      };
    }
    if (shownItem.current.kind !== kind || shownItem.current.number !== number) return;
    if (result.ok) reportChanged(item);
    else if (result.failure.kind === 'notInstalled' || result.failure.kind === 'loggedOut')
      showForgeFailure(result.failure);
    else setActionState({ performing: null, failed: { action, detail: result.failure.detail } });
  };
  const actions: Actions = {
    ...actionState,
    perform: action => void perform(action),
    dismiss: () => setActionState(state => ({ ...state, failed: null })),
  };
  const followLink = (links: ForgeLinks) => (event: MouseEvent) => {
    const href = event.target instanceof Element ? event.target.closest('a')?.getAttribute('href') : undefined;
    const linked = href ? linkedItem(href, links) : null;
    if (!linked) return;
    event.preventDefault();
    open(linked);
  };

  return (
    <section className="forge-detail" aria-label={t(kindText[kind].region)} onKeyDown={keydown}>
      <div
        className="forge-detail-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeDetail')}
        onPointerDown={resize}
      />
      <header className="forge-detail-bar">
        <button aria-label={t('detailBack')} data-hint={t('detailBack')} disabled={!canBack} onClick={back}>
          ‹
        </button>
        <span className="forge-detail-crumb">{t(kindText[kind].crumb, { number })}</span>
        <span className="forge-spacer" />
        {loadedItem && (
          <a href={loadedItem.url} target="_blank" rel="noreferrer">
            {t('openOnForge', { forge: project.forge.name })}
          </a>
        )}
        <button aria-label={t('closeDetail')} data-hint={t('closeDetail')} onClick={close}>
          ×
        </button>
      </header>
      {stale && <StaleNotice detail={text(stale.detail)} retry={retry} />}
      <div className="forge-detail-scroll" ref={scroller} tabIndex={-1}>
        {!result ? (
          <p className="forge-empty" role="status">
            {t('loadingDetail', { number })}
          </p>
        ) : !result.ok ? (
          <div className="forge-sidebar-state">
            <p role="alert">
              {t('detailLoadFailed', { number, reason: nestedMessage(result.failure.detail || result.failure.kind) })}
            </p>
            <button
              onClick={() => {
                setLoaded(null);
                retry();
              }}
            >
              {t('retry')}
            </button>
          </div>
        ) : 'issue' in result ? (
          <IssueDocument
            project={project}
            issue={result.issue}
            open={open}
            followLink={followLink(result.issue.links)}
            actions={actions}
            dispatch={issueDispatch(result.issue)}
          />
        ) : (
          <PullRequestDocument
            project={project}
            pullRequest={result.pullRequest}
            open={open}
            followLink={followLink(result.pullRequest.links)}
            actions={actions}
          />
        )}
      </div>
    </section>
  );
}
