import { useId, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueDetail, RelatedIssue, SubIssue } from '../../shared/forge/forge';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { IssueIcon, ItemReference, MoreOnForge, OpenPullRequestChecks, PullRequestIcon } from './ForgeDisplay';
import { presentOtherRelations } from './other-relations';
import './other-relations.css';

export type RelationRowName = 'otherBlockers' | 'unblocks' | 'pullRequestAbbreviation';

export function OtherRelations({
  issue,
  siblings,
  blocking,
  forge,
  open,
}: {
  issue: IssueDetail;
  siblings: SubIssue[] | null;
  blocking: boolean;
  forge: string;
  open(item: DetailItem): void;
}) {
  const { t } = useLocalization();
  const { blockers, unblocks } = presentOtherRelations(issue, { siblings, blocking });
  const blockerNote = ({ unresolved, allResolved }: { unresolved: number; allResolved: boolean }) => {
    if (unresolved) return t('unresolvedBlockers', { count: unresolved });
    return allResolved ? t('blockersResolved') : undefined;
  };
  const chips = ({ issues, unlisted }: { issues: RelatedIssue[]; unlisted: number }) => (
    <>
      {issues.map(related => (
        <IssueChip key={related.url} related={related} issue={issue} open={open} />
      ))}
      {unlisted > 0 && <MoreOnForge message="moreRelations" count={unlisted} forge={forge} url={issue.url} />}
    </>
  );
  return (
    <section className="forge-box forge-other-relations" aria-label={t('otherRelations')}>
      {blockers && (
        <RelationRow name="otherBlockers" note={blockerNote(blockers)}>
          {chips(blockers)}
        </RelationRow>
      )}
      {unblocks && <RelationRow name="unblocks">{chips(unblocks)}</RelationRow>}
      <RelationRow
        name="pullRequestAbbreviation"
        note={issue.closingPullRequests.length ? undefined : t('noPullRequests')}
      >
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

function IssueChip({
  related,
  issue,
  open,
}: {
  related: RelatedIssue;
  issue: IssueDetail;
  open(item: DetailItem): void;
}) {
  const { t } = useLocalization();
  const reference = `${related.path ?? ''}#${related.number} ${related.title}`;
  return (
    <ItemReference
      kind="issue"
      url={related.url}
      links={issue.links}
      open={open}
      className={`forge-relation-chip ${related.state}${related.path === null ? '' : ' outside'}`}
      hint={related.path === null ? reference : `${reference}\n${t('opensInBrowser')}`}
      label={reference}
    >
      <IssueIcon issue={related} size={11} decorative />
      {related.path?.split('/').at(-1)}#{related.number}
    </ItemReference>
  );
}

function RelationRow({
  name,
  note,
  children,
}: {
  name: RelationRowName;
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
