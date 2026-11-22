import type { MouseEvent } from 'react';
import { useLocalization } from '../common/Localization';
import type {
  Check,
  CheckOutcome,
  ForgeCapabilities,
  MergeState,
  PullRequestDetail,
  RepositoryReference,
  ReviewVerdict,
} from '../../shared/forge/forge';
import type { ProjectView } from '../../shared/model';
import { ActionFailure, PullRequestActions, ReopenPullRequest, type Actions } from './DirectActions';
import {
  IssueIcon,
  ItemReference,
  Label,
  Post,
  PullRequestIcon,
  PullRequestPill,
  RelativeTime,
  withElements,
} from './ForgeDisplay';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { checkDuration, checkTones, unlistedChecks } from './merge-requirements';
import './pull-request-detail.css';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  pullRequest: PullRequestDetail;
  open(item: DetailItem): void;
  followLink(event: MouseEvent): void;
  actions: Actions;
}

const verdicts: Record<
  ReviewVerdict,
  { name: 'verdictApproved' | 'verdictChangesRequested' | 'verdictCommented' | 'verdictDismissed'; tone: string }
> = {
  approved: { name: 'verdictApproved', tone: 'open' },
  changesRequested: { name: 'verdictChangesRequested', tone: 'failed' },
  commented: { name: 'verdictCommented', tone: 'skipped' },
  dismissed: { name: 'verdictDismissed', tone: 'skipped' },
};

export function PullRequestDocument({ project, pullRequest, open, followLink, actions }: Props) {
  const { t } = useLocalization();
  const forge = project.forge.name;
  return (
    <div className="forge-doc" onClick={followLink}>
      <h2>
        {pullRequest.title} <span className="forge-row-number">#{pullRequest.number}</span>
      </h2>
      <div className="forge-doc-head">
        <PullRequestPill state={pullRequest.state} />
        <span className="forge-pull-branches">
          {withElements(slots => t('wantsToMerge', slots), {
            author: <b>{pullRequest.author ?? t('deletedAccount')}</b>,
            head: <code className="forge-branch">{pullRequest.head}</code>,
            base: <code className="forge-branch">{pullRequest.base}</code>,
          })}
          {' · '}
          <RelativeTime iso={pullRequest.createdAt} />
        </span>
      </div>
      <div className="forge-doc-head">
        <a href={pullRequest.changesUrl} target="_blank" rel="noreferrer">
          {t('viewChanges', { forge })}
        </a>
        {pullRequest.labels.map(label => (
          <Label key={label.name} label={label} />
        ))}
      </div>
      {!!pullRequest.closingIssues.length && (
        <div className="forge-closes" role="group" aria-label={t('closesOnMerge')}>
          <span>{t('closesOnMerge')}</span>
          {pullRequest.closingIssues.map(issue => (
            <ItemReference
              key={issue.url}
              kind="issue"
              url={issue.url}
              links={pullRequest.links}
              open={open}
              className="forge-ref inline"
              hint={issue.title}
            >
              <IssueIcon issue={issue} size={12} decorative />
              <span className="forge-ellipsis">{issue.title}</span>
              <span className="forge-row-number">#{issue.number}</span>
            </ItemReference>
          ))}
        </div>
      )}
      <div className="forge-doc-main">
        <Post author={pullRequest.author} createdAt={pullRequest.createdAt} html={pullRequest.body} />
        {!!pullRequest.earlierEntries && (
          <a className="forge-earlier" href={pullRequest.url} target="_blank" rel="noreferrer">
            {t('earlierEntries', { count: pullRequest.earlierEntries, forge })}
          </a>
        )}
        {pullRequest.timeline.map((entry, index) => (
          <Post
            key={index}
            {...entry}
            verdict={
              entry.verdict && (
                <span className={`forge-checks forge-${verdicts[entry.verdict].tone}`}>
                  {t(verdicts[entry.verdict].name)}
                </span>
              )
            }
          />
        ))}
        <MergeArea pullRequest={pullRequest} capabilities={project.capabilities} forge={forge} actions={actions} />
      </div>
    </div>
  );
}

const outcomeNames = {
  queued: 'checkQueued',
  inProgress: 'checkInProgress',
  waiting: 'checkWaiting',
  pending: 'checkPending',
  requested: 'checkRequested',
  expected: 'checkExpected',
  completed: 'checkCompleted',
  success: 'checkSuccess',
  failure: 'checkFailure',
  error: 'checkError',
  cancelled: 'checkCancelled',
  timedOut: 'checkTimedOut',
  actionRequired: 'checkActionRequired',
  startupFailure: 'checkStartupFailure',
  neutral: 'checkNeutral',
  skipped: 'checkSkipped',
  stale: 'checkStale',
} as const satisfies Record<CheckOutcome, string>;

function Duration({ check }: { check: Check }) {
  const { t } = useLocalization();
  const duration = checkDuration(check);
  if (!duration) return null;
  return (
    <span className="forge-check-duration">
      {duration.unit === 'hours'
        ? t('durationHours', duration)
        : duration.unit === 'minutes'
          ? t('durationMinutes', duration)
          : t('durationSeconds', duration)}
    </span>
  );
}

function CheckItem({ check, requiredChecks }: { check: Check; requiredChecks: boolean }) {
  const { t } = useLocalization();
  const { mark, tone } = checkTones[check.tone];
  return (
    <div className="forge-merge-check">
      <span className={`forge-${tone}`}>{mark}</span>
      <span className="forge-check-text">
        <span className="forge-check-line">
          <span className="forge-ellipsis forge-check-name">
            {check.workflow ? `${check.workflow} / ${check.name}` : check.name}
          </span>
          {requiredChecks && check.required && <span className="forge-required">{t('requiredCheck')}</span>}
          <span className="forge-spacer" />
          <span className={`forge-${tone} forge-check-outcome`}>{t(outcomeNames[check.outcome])}</span>
          <Duration check={check} />
          {check.url && (
            <a href={check.url} target="_blank" rel="noreferrer">
              {t('checkLog')}
            </a>
          )}
        </span>
        {check.description && <span className="forge-ellipsis forge-check-description">{check.description}</span>}
      </span>
    </div>
  );
}

const mergeStates = {
  clean: { mark: '✓', tone: 'open' },
  hasHooks: { mark: '✓', tone: 'open' },
  unstable: { mark: '●', tone: 'pending' },
  dirty: { mark: '✗', tone: 'failed' },
  behind: { mark: '✗', tone: 'failed' },
  blocked: { mark: '✗', tone: 'failed' },
  unknown: { mark: '●', tone: 'pending' },
} as const satisfies Record<MergeState, { mark: string; tone: string }>;

function MergeArea({
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
  const label = t('mergeRequirements');
  if (pullRequest.state === 'merged' || pullRequest.state === 'closed')
    return (
      <section className="forge-merge" aria-label={label}>
        <div className="forge-merge-row">
          <PullRequestIcon state={pullRequest.state} hint={false} />
          {t(pullRequest.state === 'merged' ? 'stateMerged' : 'closedWithoutMerging')}
          <span className="forge-spacer" />
          <ReopenPullRequest pullRequest={pullRequest} actions={actions} />
        </div>
        {actions.failed && (
          <div className="forge-merge-actions">
            <ActionFailure actions={actions} />
          </div>
        )}
      </section>
    );

  const review = {
    approved: { mark: '✓', tone: 'open', text: t('reviewApproved') },
    changesRequested: { mark: '✗', tone: 'failed', text: t('reviewChangesRequested') },
    reviewRequired: { mark: '●', tone: 'pending', text: t('reviewRequired') },
    none: { mark: '●', tone: 'skipped', text: t('reviewNotRequired') },
  }[pullRequest.reviewDecision ?? 'none'];
  const { checks } = pullRequest;
  const checksHead = checks.state
    ? {
        ...checkTones[checks.state.tone],
        text: t('checksState', {
          outcome: t(outcomeNames[checks.state.outcome]),
          counts: checks.counts.map(({ outcome, count }) =>
            t('checkCount', { outcome: t(outcomeNames[outcome]), count }),
          ),
        }),
      }
    : { mark: '–', tone: 'skipped', text: t('checksNone') };
  const unlisted = unlistedChecks(pullRequest);
  const merge = {
    ...mergeStates[pullRequest.mergeState],
    text: {
      clean: () => t('mergeStateClean'),
      hasHooks: () => t('mergeStateClean'),
      unstable: () => t('mergeStateUnstable'),
      dirty: () => t('mergeStateDirty', { base: pullRequest.base }),
      behind: () => t('mergeStateBehind', { base: pullRequest.base }),
      blocked: () => t('mergeStateBlocked'),
      unknown: () => t('mergeStateUnknown', { forge }),
    }[pullRequest.mergeState](),
  };
  const row = (mark: string, tone: string, name: string, text: React.ReactNode) => (
    <div className="forge-merge-row">
      <span className={`forge-${tone}`}>{mark}</span>
      <b>{name}</b>
      <span>{text}</span>
    </div>
  );
  return (
    <section className="forge-merge" aria-label={label}>
      {row(review.mark, review.tone, t('reviewRow'), review.text)}
      <div className="forge-merge-row column">
        <div className="forge-merge-row-head">
          <span className={`forge-${checksHead.tone}`}>{checksHead.mark}</span>
          <b>{t('checksRow')}</b>
          <span>{checksHead.text}</span>
        </div>
        {checks.listed.map((check, index) => (
          <CheckItem key={index} check={check} requiredChecks={capabilities.requiredChecks} />
        ))}
        {!!unlisted && (
          <a className="forge-more-checks" href={checks.url} target="_blank" rel="noreferrer">
            {t('moreChecks', { count: unlisted, forge })}
          </a>
        )}
      </div>
      {row(merge.mark, merge.tone, t('mergeStateRow'), merge.text)}
      {pullRequest.state === 'draft' && row('●', 'skipped', t('draftRow'), t('draftNote', { forge }))}
      <PullRequestActions pullRequest={pullRequest} capabilities={capabilities} forge={forge} actions={actions} />
    </section>
  );
}
