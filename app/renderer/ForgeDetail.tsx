import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocalization } from './Localization';
import { detail as reason } from '../shared/messages';
import type { DirectAction, DirectActionResult, ForgeFailure, ForgeLinks, IssueDetail, PullRequestDetail, RepositoryReference } from '../shared/forge';
import type { ProjectView } from '../shared/model';
import { linkedItem, type DetailItem } from './ForgeDisplay';
import { idleActions, type Actions, type ActionState } from './DirectActions';
import { IssueDocument } from './IssueDetail';
import { PullRequestDocument } from './PullRequestDetail';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  item: DetailItem;
  width: number;
  /** Starts dragging the detail's left edge. */
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  canBack: boolean;
  back(): void;
  close(): void;
  /** Opens an issue or pull request of the bound repository in this detail. */
  open(item: DetailItem): void;
  /** Counts the sidebar's refreshes; each one reloads the detail. */
  generation: number;
  /** The sidebar's one refresh, of the list and this detail. */
  refresh(): void;
  /** Puts the sidebar in the failure state of a forge CLI found missing or logged out. */
  forgeFailed(failure: ForgeFailure): void;
}

type Loaded = { ok: true; issue: IssueDetail } | { ok: true; pullRequest: PullRequestDetail } | { ok: false; failure: ForgeFailure };
const load = (projectId: string, { kind, number }: DetailItem): Promise<Loaded> =>
  kind === 'issue' ? window.workbench.issueDetail(projectId, number) : window.workbench.pullRequestDetail(projectId, number);
/** Each kind's own texts. */
const kindText = {
  issue: { region: 'issueDetail', crumb: 'issueCrumb' },
  pullRequest: { region: 'pullRequestDetail', crumb: 'pullRequestCrumb' },
} as const;

/** The detail of one issue or pull request of the bound repository, opening leftwards from the sidebar's edge,
 * in one column like the forge. Issue and pull request links of the bound repository open here; every other link opens
 * in the browser. A direct action that succeeds refreshes the sidebar, and what the forge then holds shows; there is no
 * optimistic update. Each reload clears the actions' state, so a failure stays until dismissed or the next refresh. */
export function ForgeDetailPane({ project, item, width, resize, canBack, back, close, open, generation, refresh, forgeFailed }: Props) {
  const { t, text } = useLocalization();
  const [loaded, setLoaded] = useState<{ item: DetailItem; result: Loaded } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [actionState, setActionState] = useState<ActionState>(idleActions);
  const scroller = useRef<HTMLDivElement>(null);
  const { kind, number } = item;
  // The item shown now: an action's answer for an item no longer shown is dropped.
  const shownItem = useRef(item);
  shownItem.current = item;
  useEffect(() => {
    let current = true;
    // A failure outside the forge (the request itself) is shown like a transient one, with its reason and Retry.
    load(project.id, item)
      .catch((error: Error): Loaded => ({ ok: false, failure: { kind: 'transient', detail: text(error.message), forge: project.forge } }))
      .then(result => { if (current) { setLoaded({ item, result }); setActionState(idleActions); } });
    return () => { current = false; };
  }, [project.id, kind, number, attempt, generation]);
  useLayoutEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [kind, number]);
  const result = loaded?.item.kind === kind && loaded.item.number === number ? loaded.result : null;
  const shown = result?.ok ? 'issue' in result ? result.issue : result.pullRequest : null;
  const retry = () => { setLoaded(null); setAttempt(count => count + 1); };
  const run = async (action: DirectAction) => {
    setActionState({ running: action, failed: null });
    let result: DirectActionResult;
    // A failure outside the forge (the request itself) is shown like a transient one.
    try { result = await window.workbench.directAction(project.id, action); }
    catch (error) { result = { ok: false, failure: { kind: 'transient', detail: text((error as Error).message), forge: project.forge } }; }
    if (shownItem.current.kind !== kind || shownItem.current.number !== number) return;
    // On success the action stays running until the refreshed detail arrives.
    if (result.ok) refresh();
    else if (result.failure.kind === 'notInstalled' || result.failure.kind === 'loggedOut') forgeFailed(result.failure);
    else setActionState({ running: null, failed: { action, detail: result.failure.detail } });
  };
  const actions: Actions = { ...actionState, run: action => void run(action), dismiss: () => setActionState(state => ({ ...state, failed: null })) };
  // Links in the forge's HTML: an issue or pull request of the bound repository opens here; the filter sends the rest to the browser.
  const followLink = (links: ForgeLinks) => (event: MouseEvent) => {
    const href = (event.target as Element).closest('a')?.getAttribute('href');
    const linked = href ? linkedItem(href, links) : null;
    if (!linked) return;
    event.preventDefault();
    open(linked);
  };

  return <section className="forge-detail" aria-label={t(kindText[kind].region)} style={{ width }}>
    <div className="forge-detail-resize" role="separator" aria-orientation="vertical" aria-label={t('resizeDetail')} onPointerDown={resize} />
    <header className="forge-detail-bar">
      <button aria-label={t('detailBack')} data-hint={t('detailBack')} disabled={!canBack} onClick={back}>‹</button>
      <span className="forge-detail-crumb">{t(kindText[kind].crumb, { number })}</span>
      <span className="forge-spacer" />
      {shown && <a href={shown.url} target="_blank" rel="noreferrer">{t('openOnForge', { forge: project.forge.name })}</a>}
      <button aria-label={t('closeDetail')} data-hint={t('closeDetail')} onClick={close}>×</button>
    </header>
    <div className="forge-detail-scroll" ref={scroller} tabIndex={-1}>
      {!result ? <p className="forge-empty">{t('loadingDetail', { number })}</p>
        : !result.ok ? <div className="forge-sidebar-state">
          <p>{t('detailLoadFailed', { number, reason: reason(result.failure.detail || result.failure.kind) })}</p>
          <button onClick={retry}>{t('retry')}</button>
        </div>
        : 'issue' in result ? <IssueDocument project={project} issue={result.issue} open={open} followLink={followLink(result.issue.links)} actions={actions} />
        : <PullRequestDocument project={project} pullRequest={result.pullRequest} open={open} followLink={followLink(result.pullRequest.links)} actions={actions} />}
    </div>
  </section>;
}
