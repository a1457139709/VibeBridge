import { useEffect, useState, type ReactNode } from 'react';
import type { DesktopAPI } from '../shared/api';
import { mergeBlockers, platformDescriptions, type DirectAction, type IssueDetail, type MergeMethod, type MergeRequestDetail,
  type PlatformFailure, type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { platformFailureReason } from './platform-failure';
import './direct-actions.css';

/** Where a detail's direct actions report what came of them. */
export interface DirectActionHost {
  /** The platform took a change: the detail and its list read afresh once, and only that read shows the change. */
  changed(): void;
  /** The platform's CLI turned out missing or signed out; the sidebar shows that instead of its content. */
  unavailable(failure: PlatformFailure): void;
  /** Counts the sidebar's refreshes; a refusal shown clears on the next one. */
  refreshes: number;
}

type Api = Pick<DesktopAPI, 'directAction'>;

// The merge method last chosen, offered first for every merge request until the app quits.
let chosenMethod: MergeMethod | undefined;

const sameAction = (a: DirectAction | undefined, b: DirectAction) => JSON.stringify(a) === JSON.stringify(b);

/** Runs one action at a time for an item. A refusal stays under the buttons until dismissed, the item is read afresh or the sidebar refreshes. */
function useDirectActions(projectId: string, item: object, host: DirectActionHost, api: Api) {
  const { t, text } = useLocalization();
  const [state, setState] = useState<{ running?: DirectAction; failure?: { action: DirectAction; reason: string } }>({});
  useEffect(() => setState(current => current.running ? current : {}), [item, host.refreshes]);
  const run = (action: DirectAction) => {
    setState({ running: action });
    api.directAction(projectId, action).then(result => {
      if (result.ok) { setState({}); host.changed(); }
      else if (result.failure.kind === 'notInstalled' || result.failure.kind === 'signedOut') { setState({}); host.unavailable(result.failure); }
      else setState({ failure: { action, reason: platformFailureReason(t, result.failure, { failed: reason => reason }) } });
    }, (error: Error) => setState({ failure: { action, reason: text(error.message) } }));
  };
  const busy = state.running !== undefined;
  const { failure } = state;
  return {
    run, busy,
    running: (action: DirectAction) => sameAction(state.running, action),
    button: (action: DirectAction, label: string, className?: string) => <button className={className} aria-busy={sameAction(state.running, action)}
      disabled={busy} onClick={() => run(action)}>{label}</button>,
    failure: failure && <p className="direct-action-failure" role="alert">
      <span className="direct-action-reason">{failure.reason}</span>
      <button disabled={busy} onClick={() => run(failure.action)}>{t('retry')}</button>
      <button aria-label={t('dismissFailure')} onClick={() => setState({})}>×</button>
    </p>,
  };
}

/** A split button: the main action, and a ▾ that opens a menu of the others. */
function SplitButton({ main, label, disabled, children }: { main: ReactNode; label: string; disabled: boolean; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="split-button">
    {main}
    <button className="split-button-more" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(shown => !shown)}>▾</button>
    {open && !disabled && <div className="split-button-menu" role="menu" aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>{children(() => setOpen(false))}</div>}
  </span>;
}

/** Closing an open issue as completed, or as not planned from the menu; reopening a closed one. Shown only with write access. */
export function IssueActions({ projectId, issue, host, api = window.workbench }: { projectId: string; issue: IssueDetail; host: DirectActionHost; api?: Api }) {
  const { t } = useLocalization();
  const actions = useDirectActions(projectId, issue, host, api);
  if (!issue.writable) return null;
  const close = (reason: 'completed' | 'notPlanned'): DirectAction => ({ kind: 'closeIssue', number: issue.number, reason });
  return <section className="direct-actions">
    <div className="direct-action-buttons">
      {issue.state === 'open'
        ? <SplitButton main={actions.button(close('completed'), t('closeAsCompleted'), 'split-button-main')} label={t('moreWaysToClose')} disabled={actions.busy}>
          {done => <button role="menuitem" onClick={() => { done(); actions.run(close('notPlanned')); }}>{t('closeAsNotPlanned')}</button>}
        </SplitButton>
        : actions.button({ kind: 'reopenIssue', number: issue.number }, t('reopen'))}
    </div>
    {actions.failure}
  </section>;
}

const methodNames = { merge: 'mergeWithMerge', squash: 'mergeWithSquash', rebase: 'mergeWithRebase' } as const;
const routeNames = { mergeQueue: 'mergeThroughQueue', autoMerge: 'mergeThroughAutoMerge' } as const;

const blockerNames = {
  draft: 'mergeDraft', conflicts: 'mergeBlockedConflicts', reviewRequired: 'mergeBlockedReview', changesRequested: 'mergeBlockedChangesRequested',
  checksFailing: 'mergeBlockedChecksFailing', checksPending: 'mergeBlockedChecksPending',
} as const;

/**
 * Merging an open merge request in two clicks with one of the repository's methods, and closing it; reopening a closed one.
 * A merge the platform would block is greyed out with why; one that must go through a merge queue or auto-merge is left to the platform.
 */
export function MergeRequestActions({ projectId, repository, request, host, api = window.workbench }: {
  projectId: string; repository: RepositoryReference; request: MergeRequestDetail; host: DirectActionHost; api?: Api;
}) {
  const { t } = useLocalization();
  const actions = useDirectActions(projectId, request, host, api);
  const [method, setMethod] = useState(chosenMethod);
  const [confirming, setConfirming] = useState(false);
  if (!request.writable || request.state === 'merged') return null;
  const { number, merge } = request;
  if (request.state === 'closed') {
    return <section className="direct-actions">
      <div className="direct-action-buttons">{actions.button({ kind: 'reopenMergeRequest', number }, t('reopen'))}</div>
      {actions.failure}
    </section>;
  }
  const platform = platformDescriptions[repository.platform];
  const current = method && merge.methods.includes(method) ? method : merge.methods[0];
  const reasons = mergeBlockers(request.draft, merge, platform).map(blocker => blockerNames[blocker]);
  const blocked = !!reasons.length || !!merge.mergeThrough;
  const mergeAction: DirectAction | undefined = current && { kind: 'mergeMergeRequest', number, method: current };
  return <div className="direct-actions">
    <div className="direct-action-buttons">
      {mergeAction && (confirming
        ? <>
          <button className="primary" disabled={actions.busy} onClick={() => { setConfirming(false); actions.run(mergeAction); }}>{t('confirmMerge')}</button>
          <button onClick={() => setConfirming(false)}>{t('cancelMerge')}</button>
        </>
        : <SplitButton label={t('mergeMethods')} disabled={actions.busy || blocked}
          main={<button className="split-button-main primary" aria-busy={actions.running(mergeAction)} disabled={actions.busy || blocked}
            onClick={() => setConfirming(true)}>{t(methodNames[mergeAction.method])}</button>}>
          {done => merge.methods.map(each => <button key={each} role="menuitemradio" aria-checked={each === current}
            onClick={() => { chosenMethod = each; setMethod(each); done(); }}>{t(methodNames[each])}</button>)}
        </SplitButton>)}
      {actions.button({ kind: 'closeMergeRequest', number }, t('closeMergeRequest'))}
    </div>
    {!!reasons.length && <ul className="merge-blockers" aria-label={t('mergeBlocked')}>{reasons.map(reason => <li key={reason}>{t(reason)}</li>)}</ul>}
    {merge.mergeThrough && <p className="merge-on-platform">{t(routeNames[merge.mergeThrough], { platform: platform.name })}{' '}
      <a href={request.url} target="_blank" rel="noreferrer">{t('openInBrowser')}</a></p>}
    {actions.failure}
  </div>;
}
