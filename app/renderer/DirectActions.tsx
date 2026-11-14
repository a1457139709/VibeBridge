import { useEffect, useRef, useState } from 'react';
import { useLocalization } from './Localization';
import './direct-actions.css';
import type { DirectAction, ForgeCapabilities, IssueDetail, MergeMethod, PullRequestDetail } from '../shared/forge';

/** The direct action on the shown item that is running, and the last one that failed with the forge's text. */
export interface ActionState {
  running: DirectAction | null;
  failed: { action: DirectAction; detail: string } | null;
}
export const idleActions: ActionState = { running: null, failed: null };
/** The shown item's direct actions: what is running or failed, and how to run one or dismiss the failure. */
export interface Actions extends ActionState {
  run(action: DirectAction): void;
  dismiss(): void;
}

const methodNames = {
  merge: { name: 'mergeMethodMerge', confirm: 'confirmMergeMerge' },
  squash: { name: 'mergeMethodSquash', confirm: 'confirmMergeSquash' },
  rebase: { name: 'mergeMethodRebase', confirm: 'confirmMergeRebase' },
} as const;
/** The merge method last chosen, remembered while the app runs and never saved. */
let lastMergeMethod: MergeMethod | null = null;

/** A popover menu that closes on a click outside it or on Esc. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return { open, setOpen, root };
}

/** The failed action's name and the forge's reason, unchanged, under the buttons, with Retry and Dismiss. */
export function ActionFailure({ actions }: { actions: Actions }) {
  const { t } = useLocalization();
  const { failed } = actions;
  if (!failed) return null;
  const { action } = failed;
  const name = action.kind === 'closeIssue' ? t(action.reason === 'completed' ? 'closeAsCompleted' : 'closeAsNotPlanned')
    : action.kind === 'reopenIssue' ? t('reopenIssue') : action.kind === 'merge' ? t(methodNames[action.method].name)
    : action.kind === 'closePullRequest' ? t('closePullRequest') : t('reopenPullRequest');
  return <div className="forge-action-error" role="alert">
    <span>{t('actionFailed', { action: name, reason: failed.detail })}</span>
    <button className="forge-text-button" onClick={() => actions.run(action)}>{t('retry')}</button>
    <button className="forge-text-button" aria-label={t('dismissFailure')} data-hint={t('dismissFailure')} onClick={actions.dismiss}>×</button>
  </div>;
}

/** An issue's direct actions at the bottom of its detail, for an account with write access: Close issue (as completed),
 * with closing as not planned in its menu; a closed issue reopens. */
export function IssueActions({ issue, actions }: { issue: IssueDetail; actions: Actions }) {
  const { t } = useLocalization();
  const menu = useMenu();
  if (!issue.canWrite) return null;
  const busy = actions.running !== null;
  const close = (reason: 'completed' | 'notPlanned') => { menu.setOpen(false); actions.run({ kind: 'closeIssue', number: issue.number, reason }); };
  return <div className="forge-issue-actions">
    {issue.state === 'closed'
      ? <button className="forge-btn" disabled={busy} onClick={() => actions.run({ kind: 'reopenIssue', number: issue.number })}>
        {busy ? t('actionWorking') : t('reopenIssue')}</button>
      : <span className="forge-split" ref={menu.root}>
        <button className="forge-split-main" disabled={busy} onClick={() => close('completed')}>{busy ? t('actionWorking') : t('closeIssue')}</button>
        <button className="forge-split-more" disabled={busy} aria-label={t('moreCloseOptions')} aria-haspopup="menu" aria-expanded={menu.open}
          onClick={() => menu.setOpen(open => !open)}>▾</button>
        {menu.open && <div className="forge-popover forge-close-menu" role="menu" aria-label={t('moreCloseOptions')}>
          <button role="menuitem" onClick={() => close('completed')}>{t('closeAsCompleted')}</button>
          <button role="menuitem" onClick={() => close('notPlanned')}>{t('closeAsNotPlanned')}</button>
        </div>}
      </span>}
    <ActionFailure actions={actions} />
  </div>;
}

/** Reopening a closed pull request, in the merge area's closed row, for an account with write access. */
export function ReopenPullRequest({ pullRequest: pull, actions }: { pullRequest: PullRequestDetail; actions: Actions }) {
  const { t } = useLocalization();
  if (!pull.canWrite || pull.state !== 'closed') return null;
  return <button className="forge-btn" disabled={actions.running !== null} onClick={() => actions.run({ kind: 'reopenPullRequest', number: pull.number })}>
    {actions.running ? t('actionWorking') : t('reopenPullRequest')}</button>;
}

/** What keeps an open pull request from merging, as the forge reports it: a draft, conflicts, required checks, the review. */
function mergeBlocks(pull: PullRequestDetail, capabilities: ForgeCapabilities, t: ReturnType<typeof useLocalization>['t']) {
  const required = pull.checks.filter(check => capabilities.requiredChecks && check.required);
  const { state: review, requiredApprovals } = pull.review;
  return [
    pull.state === 'draft' && t('mergeBlockedDraft'),
    pull.conflicts === 'conflicting' && t('mergeBlockedConflicts'),
    required.some(check => check.result === 'failed') ? t('mergeBlockedChecksFailing') : required.some(check => check.result === 'pending') && t('mergeBlockedChecksRunning'),
    review === 'changesRequested' ? t('mergeBlockedChangesRequested')
      : review === 'required' && (requiredApprovals ? t('mergeBlockedApprovals', { count: requiredApprovals }) : t('mergeBlockedReview')),
  ].filter((reason): reason is string => !!reason);
}

/** The merge area's buttons for an open pull request, for an account with write access. Merge is a split button whose
 * menu lists the methods the repository allows; it merges on a second click that confirms in place, with the forge's
 * default commit message. A blocked merge is greyed with its reasons; a repository that merges through a merge queue is
 * left to the forge. Close PR is on the right. */
export function PullRequestActions({ pullRequest: pull, capabilities, forge, actions }: {
  pullRequest: PullRequestDetail; capabilities: ForgeCapabilities; forge: string; actions: Actions;
}) {
  const { t } = useLocalization();
  const menu = useMenu();
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState(lastMergeMethod);
  if (!pull.canWrite) return null;
  const busy = actions.running !== null;
  const methods = pull.merge.methods.filter(method => capabilities.mergeMethods.includes(method));
  const method = chosen && methods.includes(chosen) ? chosen : methods[0] ?? null;
  const blocks = mergeBlocks(pull, capabilities, t);
  const blocked = !!blocks.length || !method;
  const choose = (next: MergeMethod) => { lastMergeMethod = next; setChosen(next); setConfirming(false); menu.setOpen(false); };
  const merge = () => {
    if (!method) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    actions.run({ kind: 'merge', number: pull.number, method });
  };
  const mainLabel = actions.running?.kind === 'merge' ? t('merging') : !method ? t('mergeButton')
    : confirming ? t(methodNames[method].confirm) : t(methodNames[method].name);
  return <div className="forge-merge-actions">
    <div className="forge-merge-buttons">
      {capabilities.mergeQueue && pull.merge.queue
        ? <span className="forge-merge-why"><button className="forge-btn" disabled>{t('mergeButton')}</button>{t('mergeQueueNote')}
          <a href={pull.url} target="_blank" rel="noreferrer">{t('openOnForge', { forge })}</a></span>
        : <span className="forge-merge-why">
          <span className={`forge-split ${blocked ? 'weak' : ''}`} ref={menu.root}>
            <button className="forge-split-main" disabled={blocked || busy} onClick={merge}>{mainLabel}</button>
            <button className="forge-split-more" disabled={blocked || busy} aria-label={t('chooseMergeMethod')} aria-haspopup="menu" aria-expanded={menu.open}
              onClick={() => menu.setOpen(open => !open)}>▾</button>
            {menu.open && <div className="forge-popover forge-method-menu" role="menu" aria-label={t('chooseMergeMethod')}>
              {methods.map(item => <button key={item} role="menuitemradio" aria-checked={item === method} onClick={() => choose(item)}>
                {t(methodNames[item].name)}</button>)}
            </div>}
          </span>
          {!!blocks.length && <span className="forge-muted">{t('cannotMerge', { reasons: blocks })}</span>}
        </span>}
      <span className="forge-spacer" />
      <button className="forge-btn" disabled={busy} onClick={() => actions.run({ kind: 'closePullRequest', number: pull.number })}>
        {actions.running?.kind === 'closePullRequest' ? t('actionWorking') : t('closePullRequest')}</button>
    </div>
    <ActionFailure actions={actions} />
  </div>;
}
