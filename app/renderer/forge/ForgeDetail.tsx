import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocalization } from '../common/Localization';
import { detail as reason } from '../../shared/messages';
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
import { withoutCommandModifier } from '../../shared/settings/shortcuts';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  item: DetailItem;
  /** Starts dragging the detail's left edge. */
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  canBack: boolean;
  back(): void;
  /** Closes the detail, with focus back on the list row of its item, or on the list when no such row shows. */
  close(): void;
  /** Opens an issue or pull request of the bound repository in this detail. */
  open(item: DetailItem): void;
  /** Loads the item again, after its load failed. */
  retry(): void;
  /** Reports that a direct action changed `item`; the main process reloads what shows it. */
  reportChanged(item: DetailItem): void;
  /** Puts the sidebar in the failure state of a forge CLI found missing or logged out. */
  forgeFailed(failure: ForgeFailure): void;
  /** An issue's Dispatch and Dispatch Records, as its detail shows them. */
  issueDispatch(issue: IssueDetail): IssueDispatch;
}

/** Each kind's own texts. */
const kindText = {
  issue: { region: 'issueDetail', crumb: 'issueCrumb' },
  pullRequest: { region: 'pullRequestDetail', crumb: 'pullRequestCrumb' },
} as const;

/** The detail of one issue or pull request of the bound repository, opening leftwards from the sidebar's edge,
 * in one column like the forge. Issue and pull request links of the bound repository open here; every other link opens
 * in the browser. The sidebar declares the item it shows, and the main process pushes what the forge answers. A direct
 * action that succeeds is reported, and what the forge then holds shows; there is no optimistic update. Each answer
 * pushed clears the actions' state, so a failure stays until dismissed or the next refresh. */
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
  forgeFailed,
  issueDispatch,
}: Props) {
  const { t, text } = useLocalization();
  /** The last answer the main process pushed (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md); it shows
   * while it is for the item shown, as when Back returns to it, until a new answer arrives. */
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
  // The item shown now: an action's answer for an item no longer shown is dropped.
  const shownItem = useRef(item);
  shownItem.current = item;
  // Focus moves into each item the detail opens, on its body: ↑/↓ scroll it there, and Tab walks its links and buttons.
  useLayoutEffect(() => {
    scroller.current?.focus({ preventScroll: true });
    scroller.current?.scrollTo?.({ top: 0 });
  }, [kind, number]);
  /** → or Esc close the detail, back to the list row. A key a field or menu inside answers goes no further. */
  const keydown = (event: React.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      (event.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]',
      )
    )
      return;
    if (event.key === 'Escape' || (event.key === 'ArrowRight' && withoutCommandModifier(event))) {
      event.preventDefault();
      close();
    }
  };
  const result = loaded?.item.kind === kind && loaded.item.number === number ? loaded.result : null;
  const shown = result?.ok ? ('issue' in result ? result.issue : result.pullRequest) : null;
  const run = async (action: DirectAction) => {
    setActionState({ running: action, failed: null });
    let result: DirectActionResult;
    // A failure outside the forge (the request itself) is shown like a transient one.
    try {
      result = await window.workbench.directAction(project.id, action);
    } catch (error) {
      result = {
        ok: false,
        failure: { kind: 'transient', detail: text((error as Error).message), forge: project.forge },
      };
    }
    if (shownItem.current.kind !== kind || shownItem.current.number !== number) return;
    // On success the action stays running until the reloaded detail arrives.
    if (result.ok) reportChanged(item);
    else if (result.failure.kind === 'notInstalled' || result.failure.kind === 'loggedOut') forgeFailed(result.failure);
    else setActionState({ running: null, failed: { action, detail: result.failure.detail } });
  };
  const actions: Actions = {
    ...actionState,
    run: action => void run(action),
    dismiss: () => setActionState(state => ({ ...state, failed: null })),
  };
  // Links in the forge's HTML: an issue or pull request of the bound repository opens here; the filter sends the rest to the browser.
  const followLink = (links: ForgeLinks) => (event: MouseEvent) => {
    const href = (event.target as Element).closest('a')?.getAttribute('href');
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
        {shown && (
          <a href={shown.url} target="_blank" rel="noreferrer">
            {t('openOnForge', { forge: project.forge.name })}
          </a>
        )}
        <button aria-label={t('closeDetail')} data-hint={t('closeDetail')} onClick={close}>
          ×
        </button>
      </header>
      <div className="forge-detail-scroll" ref={scroller} tabIndex={-1}>
        {!result ? (
          <p className="forge-empty">{t('loadingDetail', { number })}</p>
        ) : !result.ok ? (
          <div className="forge-sidebar-state">
            <p>{t('detailLoadFailed', { number, reason: reason(result.failure.detail || result.failure.kind) })}</p>
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
