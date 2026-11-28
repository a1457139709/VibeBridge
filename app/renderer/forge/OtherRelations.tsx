import { useId, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueDetail, IssueReference, SubIssue } from '../../shared/forge/forge';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { IssueIcon, ItemReference, linkedItem, OpenPullRequestChecks, PullRequestIcon } from './ForgeDisplay';
import { presentOtherRelations } from './other-relations';
import './other-relations.css';

export function OtherRelations({
  issue,
  siblings,
  blocking,
  open,
}: {
  issue: IssueDetail;
  siblings: SubIssue[] | null;
  blocking: boolean;
  open(item: DetailItem): void;
}) {
  const { t } = useLocalization();
  const { blockers, unblocks } = presentOtherRelations(issue, { siblings, blocking });
  const chips = (issues: IssueReference[]) =>
    issues.map(related => (
      <ItemReference
        key={related.url}
        kind="issue"
        url={related.url}
        links={issue.links}
        open={open}
        className={`forge-relation-chip ${related.state}${linkedItem(related.url, issue.links) ? '' : ' outside'}`}
        hint={`#${related.number} ${related.title}`}
        label={`#${related.number} ${related.title}`}
      >
        <IssueIcon issue={related} size={11} decorative />#{related.number}
      </ItemReference>
    ));
  return (
    <section className="forge-box forge-other-relations" aria-label={t('otherRelations')}>
      {blockers && (
        <RelationRow
          name="otherBlockers"
          note={blockers.unresolved ? t('unresolvedBlockers', { count: blockers.unresolved }) : t('blockersResolved')}
        >
          {chips(blockers.issues)}
        </RelationRow>
      )}
      {unblocks && <RelationRow name="unblocks">{chips(unblocks)}</RelationRow>}
      <RelationRow name="pullRequestsRow" note={issue.closingPullRequests.length ? undefined : t('noPullRequests')}>
        {issue.closingPullRequests.map(pullRequest => (
          <ItemReference
            key={pullRequest.url}
            kind="pullRequest"
            url={pullRequest.url}
            links={issue.links}
            open={open}
            className={`forge-pull-chip ${pullRequest.state}`}
            hint={pullRequest.title}
            label={`#${pullRequest.number} ${pullRequest.title}`}
          >
            <PullRequestIcon state={pullRequest.state} size={11} hint={false} />#{pullRequest.number}
            <OpenPullRequestChecks state={pullRequest.state} checks={pullRequest.checks} />
          </ItemReference>
        ))}
      </RelationRow>
    </section>
  );
}

function RelationRow({
  name,
  note,
  children,
}: {
  name: 'otherBlockers' | 'unblocks' | 'pullRequestsRow';
  note?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useLocalization();
  const id = useId();
  return (
    <div
      className="forge-relation-row"
      role="group"
      aria-labelledby={`${id}-name`}
      aria-describedby={note ? `${id}-note` : undefined}
    >
      <span id={`${id}-name`} className="forge-relation-name">
        {t(name)}
      </span>
      <span className="forge-relation-chips">
        {children}
        {note && (
          <span id={`${id}-note`} className="forge-relation-note">
            {note}
          </span>
        )}
      </span>
    </div>
  );
}
