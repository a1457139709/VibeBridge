import { useState } from 'react';
import { useLocalization } from '../common/Localization';
import { usePopover } from '../common/popover';
import './direct-actions.css';
import type {
  DirectAction,
  ForgeCapabilities,
  IssueDetail,
  MergeMethod,
  PullRequestDetail,
} from '../../shared/forge/forge';

export interface ActionState {
  performing: DirectAction | null;
  failed: { action: DirectAction; detail: string } | null;
}
export const idleActions: ActionState = { performing: null, failed: null };
export interface MergeMethodMemory {
  lastMergeMethod: MergeMethod | null;
  rememberMergeMethod(method: MergeMethod): void;
}
export interface Actions extends ActionState, MergeMethodMemory {
  perform(action: DirectAction): void;
  dismiss(): void;
}

const methodNames = {
  merge: { name: 'mergeMethodMerge', confirm: 'confirmMergeMerge' },
  squash: { name: 'mergeMethodSquash', confirm: 'confirmMergeSquash' },
  rebase: { name: 'mergeMethodRebase', confirm: 'confirmMergeRebase' },
} as const;
const actionName = (action: DirectAction) =>
  (
    ({
      closeIssue:
        action.kind === 'closeIssue' && action.reason === 'notPlanned' ? 'closeAsNotPlanned' : 'closeAsCompleted',
      reopenIssue: 'reopenIssue',
      merge: action.kind === 'merge' ? methodNames[action.method].name : 'mergeButton',
      closePullRequest: 'closePullRequest',
      reopenPullRequest: 'reopenPullRequest',
    }) as const
  )[action.kind];

export function ActionFailure({ actions }: { actions: Actions }) {
  const { t } = useLocalization();
  const { failed } = actions;
  if (!failed) return null;
  const { action } = failed;
  return (
    <div className="forge-action-error" role="alert">
      <span>{t('actionFailed', { action: t(actionName(action)), reason: failed.detail })}</span>
      <button className="forge-text-button" onClick={() => actions.perform(action)}>
        {t('retry')}
      </button>
      <button
        className="forge-text-button"
        aria-label={t('dismissFailure')}
        data-hint={t('dismissFailure')}
        onClick={actions.dismiss}
      >
        ×
      </button>
    </div>
  );
}

export function IssueActions({ issue, actions }: { issue: IssueDetail; actions: Actions }) {
  const { t } = useLocalization();
  const menu = usePopover<HTMLSpanElement>();
  if (!issue.canWrite) return null;
  const busy = actions.performing !== null;
  const close = (reason: 'completed' | 'notPlanned') => {
    menu.setOpen(false);
    actions.perform({ kind: 'closeIssue', number: issue.number, reason });
  };
  return (
    <div className="forge-issue-actions">
      {issue.state === 'closed' ? (
        <button
          className="forge-btn"
          disabled={busy}
          onClick={() => actions.perform({ kind: 'reopenIssue', number: issue.number })}
        >
          {busy ? t('actionWorking') : t('reopenIssue')}
        </button>
      ) : (
        <span className="forge-split" ref={menu.root}>
          <button className="forge-split-main" disabled={busy} onClick={() => close('completed')}>
            {busy ? t('actionWorking') : t('closeIssue')}
          </button>
          <button
            className="forge-split-more"
            disabled={busy}
            aria-label={t('moreCloseOptions')}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            onClick={() => menu.setOpen(open => !open)}
          >
            ▾
          </button>
          {menu.open && (
            <div className="forge-popover forge-close-menu" role="menu" aria-label={t('moreCloseOptions')}>
              <button role="menuitem" onClick={() => close('completed')}>
                {t('closeAsCompleted')}
              </button>
              <button role="menuitem" onClick={() => close('notPlanned')}>
                {t('closeAsNotPlanned')}
              </button>
            </div>
          )}
        </span>
      )}
      <ActionFailure actions={actions} />
    </div>
  );
}

export function ReopenPullRequest({ pullRequest, actions }: { pullRequest: PullRequestDetail; actions: Actions }) {
  const { t } = useLocalization();
  if (!pullRequest.canWrite || pullRequest.state !== 'closed') return null;
  return (
    <button
      className="forge-btn"
      disabled={actions.performing !== null}
      onClick={() => actions.perform({ kind: 'reopenPullRequest', number: pullRequest.number })}
    >
      {actions.performing ? t('actionWorking') : t('reopenPullRequest')}
    </button>
  );
}

function mergeBlockedReasons(
  pullRequest: PullRequestDetail,
  capabilities: ForgeCapabilities,
  t: ReturnType<typeof useLocalization>['t'],
) {
  const required = pullRequest.checks.filter(check => capabilities.requiredChecks && check.required);
  const { state: review, requiredApprovals } = pullRequest.review;
  return [
    pullRequest.state === 'draft' && t('mergeBlockedDraft'),
    pullRequest.conflicts === 'conflicting' && t('mergeBlockedConflicts'),
    required.some(check => check.result === 'failed')
      ? t('mergeBlockedChecksFailing')
      : required.some(check => check.result === 'pending') && t('mergeBlockedChecksRunning'),
    review === 'changesRequested'
      ? t('mergeBlockedChangesRequested')
      : review === 'required' &&
        (requiredApprovals ? t('mergeBlockedApprovals', { count: requiredApprovals }) : t('mergeBlockedReview')),
  ].filter((reason): reason is string => !!reason);
}

export function PullRequestActions({
  pullRequest,
  capabilities,
  forge,
  actions,
}: {
  pullRequest: PullRequestDetail;
  capabilities: ForgeCapabilities;
  forge: string;
  actions: Actions;
}) {
  const { t } = useLocalization();
  const menu = usePopover<HTMLSpanElement>();
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState(actions.lastMergeMethod);
  if (!pullRequest.canWrite) return null;
  const busy = actions.performing !== null;
  const methods = pullRequest.mergeOptions.methods.filter(method => capabilities.mergeMethods.includes(method));
  const method = chosen && methods.includes(chosen) ? chosen : (methods[0] ?? null);
  const reasons = mergeBlockedReasons(pullRequest, capabilities, t);
  const blocked = !!reasons.length || !method;
  const choose = (next: MergeMethod) => {
    actions.rememberMergeMethod(next);
    setChosen(next);
    setConfirming(false);
    menu.setOpen(false);
  };
  const merge = () => {
    if (!method) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    actions.perform({ kind: 'merge', number: pullRequest.number, method });
  };
  const mainLabel =
    actions.performing?.kind === 'merge'
      ? t('merging')
      : !method
        ? t('mergeButton')
        : confirming
          ? t(methodNames[method].confirm)
          : t(methodNames[method].name);
  return (
    <div className="forge-merge-actions">
      <div className="forge-merge-buttons">
        {capabilities.mergeQueue && pullRequest.mergeOptions.queue ? (
          <span className="forge-merge-why">
            <button className="forge-btn" disabled>
              {t('mergeButton')}
            </button>
            {t('mergeQueueNote')}
            <a href={pullRequest.url} target="_blank" rel="noreferrer">
              {t('openOnForge', { forge })}
            </a>
          </span>
        ) : (
          <span className="forge-merge-why">
            <span className={`forge-split ${blocked ? 'weak' : ''}`} ref={menu.root}>
              <button className="forge-split-main" disabled={blocked || busy} onClick={merge}>
                {mainLabel}
              </button>
              <button
                className="forge-split-more"
                disabled={blocked || busy}
                aria-label={t('chooseMergeMethod')}
                aria-haspopup="menu"
                aria-expanded={menu.open}
                onClick={() => menu.setOpen(open => !open)}
              >
                ▾
              </button>
              {menu.open && (
                <div className="forge-popover forge-method-menu" role="menu" aria-label={t('chooseMergeMethod')}>
                  {methods.map(item => (
                    <button key={item} role="menuitemradio" aria-checked={item === method} onClick={() => choose(item)}>
                      {t(methodNames[item].name)}
                    </button>
                  ))}
                </div>
              )}
            </span>
            {!!reasons.length && <span className="forge-muted">{t('cannotMerge', { reasons })}</span>}
          </span>
        )}
        <span className="forge-spacer" />
        <button
          className="forge-btn"
          disabled={busy}
          onClick={() => actions.perform({ kind: 'closePullRequest', number: pullRequest.number })}
        >
          {actions.performing?.kind === 'closePullRequest' ? t('actionWorking') : t('closePullRequest')}
        </button>
      </div>
      <ActionFailure actions={actions} />
    </div>
  );
}
