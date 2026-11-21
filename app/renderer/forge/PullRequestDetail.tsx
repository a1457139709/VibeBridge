import { useState, type MouseEvent } from 'react';
import { useLocalization } from '../common/Localization';
import type {
  Check,
  ForgeCapabilities,
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
import './pull-request-detail.css';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  pullRequest: PullRequestDetail;
  /** Opens an issue or pull request of the bound repository in the detail. */
  open(item: DetailItem): void;
  /** Opens a clicked link of the bound repository in the detail. */
  followLink(event: MouseEvent): void;
  actions: Actions;
}

/** Each review verdict's name and colour, as a review summary's chip shows it. */
const verdicts: Record<
  ReviewVerdict,
  { name: 'verdictApproved' | 'verdictChangesRequested' | 'verdictCommented' | 'verdictDismissed'; tone: string }
> = {
  approved: { name: 'verdictApproved', tone: 'open' },
  changesRequested: { name: 'verdictChangesRequested', tone: 'failed' },
  commented: { name: 'verdictCommented', tone: 'skipped' },
  dismissed: { name: 'verdictDismissed', tone: 'skipped' },
};

/** One pull request as its detail shows it, in the forge's order: the title, state, head into base, where its
 * changes are, labels and the issues it closes on merge; then the body, comments and review summaries in time order,
 * code comments only as a count, and the merge area with its direct actions last. No diff, size, reviewer list or approve button. */
export function PullRequestDocument({ project, pullRequest, open, followLink, actions }: Props) {
  const { t } = useLocalization();
  const forge = project.forge.name;
  const listedCommentCount = pullRequest.timeline.filter(entry => entry.verdict === null).length;
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
        {pullRequest.commentCount > listedCommentCount && (
          <a className="forge-more-comments" href={pullRequest.url} target="_blank" rel="noreferrer">
            {t('moreComments', { count: pullRequest.commentCount, forge })}
          </a>
        )}
        {!!pullRequest.codeCommentCount && (
          <div className="forge-code-comments">
            {pullRequest.codeCommentCount === 1
              ? t('oneCodeComment')
              : t('codeComments', { count: pullRequest.codeCommentCount })}{' '}
            <a href={pullRequest.changesUrl} target="_blank" rel="noreferrer">
              {t('viewOnForge', { forge })}
            </a>
          </div>
        )}
        <MergeArea pullRequest={pullRequest} capabilities={project.capabilities} forge={forge} actions={actions} />
      </div>
    </div>
  );
}

/** Each check result's mark, name and colour; a skipped check folds with the passed ones. */
const results: Record<
  Check['result'],
  { mark: string; name: 'checksPassed' | 'checksFailed' | 'checksPending' | 'checkSkipped'; tone: string }
> = {
  passed: { mark: '✓', name: 'checksPassed', tone: 'open' },
  failed: { mark: '✗', name: 'checksFailed', tone: 'failed' },
  pending: { mark: '●', name: 'checksPending', tone: 'pending' },
  skipped: { mark: '–', name: 'checkSkipped', tone: 'skipped' },
};

/** The merge area at the bottom, one requirement per row, then the direct actions: the review, the checks (one summary line; failed and
 * running checks listed, passed ones folded; required ones marked when the forge declares required checks; each opens its
 * log), conflicts, the draft, and merging or closing it. A merged or closed pull request only says so; a closed one reopens. */
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
  const [showPassed, setShowPassed] = useState(false);
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

  const failed = pullRequest.checks.filter(check => check.result === 'failed'),
    pending = pullRequest.checks.filter(check => check.result === 'pending');
  const passed = pullRequest.checks.filter(check => check.result === 'passed' || check.result === 'skipped');
  const { state: reviewState, requiredApprovals } = pullRequest.review;
  const review = {
    approved: { mark: '✓', tone: 'open', text: t('reviewApproved') },
    changesRequested: { mark: '✗', tone: 'failed', text: t('reviewChangesRequested') },
    required: {
      mark: '●',
      tone: 'pending',
      text: requiredApprovals ? t('reviewRequiredCount', { count: requiredApprovals }) : t('reviewRequired'),
    },
    notRequired: { mark: '●', tone: 'skipped', text: t('reviewNotRequired') },
  }[reviewState];
  const checks = !pullRequest.checks.length
    ? { mark: '–', tone: 'skipped', text: t('checksNone') }
    : {
        mark: failed.length ? '✗' : pending.length ? '●' : '✓',
        tone: failed.length ? 'failed' : pending.length ? 'pending' : 'open',
        text: t('checksSummary', {
          parts: [
            ...(failed.length ? [t('checksFailedCount', { count: failed.length })] : []),
            ...(pending.length ? [t('checksPendingCount', { count: pending.length })] : []),
            ...(passed.length ? [t('checksPassedCount', { count: passed.length })] : []),
          ],
        }),
      };
  const conflicts = {
    none: { mark: '✓', tone: 'open', text: t('conflictsNone') },
    unknown: { mark: '●', tone: 'pending', text: t('conflictsUnknown') },
    conflicting: {
      mark: '✗',
      tone: 'failed',
      text: withElements(slots => t('conflictsWith', slots), {
        base: <code className="forge-branch">{pullRequest.base}</code>,
      }),
    },
  }[pullRequest.conflicts];
  const row = (mark: string, tone: string, name: string, text: React.ReactNode) => (
    <div className="forge-merge-row">
      <span className={`forge-${tone}`}>{mark}</span>
      <b>{name}</b>
      <span>{text}</span>
    </div>
  );
  const item = (check: Check, index: number) => {
    const { mark, name, tone } = results[check.result];
    return (
      <div key={index} className="forge-merge-check">
        <span className={`forge-${tone}`}>{mark}</span>
        <span className="forge-ellipsis">{check.name}</span>
        {capabilities.requiredChecks && check.required && <span className="forge-required">{t('requiredCheck')}</span>}
        <span className="forge-spacer" />
        <span className={`forge-${tone}`}>{t(name)}</span>
        {check.url && (
          <a href={check.url} target="_blank" rel="noreferrer">
            {t('checkLog')}
          </a>
        )}
      </div>
    );
  };
  return (
    <section className="forge-merge" aria-label={label}>
      {row(review.mark, review.tone, t('reviewRow'), review.text)}
      <div className="forge-merge-row column">
        <div className="forge-merge-row-head">
          <span className={`forge-${checks.tone}`}>{checks.mark}</span>
          <b>{t('checksRow')}</b>
          <span>{checks.text}</span>
        </div>
        {[...failed, ...pending].map(item)}
        {!!passed.length && (
          <button className="forge-text-button forge-merge-fold" onClick={() => setShowPassed(shown => !shown)}>
            {showPassed ? t('hidePassedChecks') : t('showPassedChecks', { count: passed.length })}
          </button>
        )}
        {showPassed && passed.map(item)}
      </div>
      {row(conflicts.mark, conflicts.tone, t('conflictsRow'), conflicts.text)}
      {pullRequest.state === 'draft' && row('●', 'skipped', t('draftRow'), t('draftNote', { forge }))}
      <PullRequestActions pullRequest={pullRequest} capabilities={capabilities} forge={forge} actions={actions} />
    </section>
  );
}
