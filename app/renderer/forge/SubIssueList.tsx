import { useId, useState } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueDetail, IssueReference } from '../../shared/forge/forge';
import { BlockedMark, IssueIcon, MoreOnForge, Progress } from './ForgeDisplay';
import { presentSubIssueRows, subIssueKey, type SubIssueRelation } from './sub-issue-rows';
import './sub-issue-list.css';

const relationMessages = {
  lit: 'subIssueLit',
  blocksLit: 'subIssueBlocksLit',
  blockedByLit: 'subIssueBlockedByLit',
  unrelated: 'subIssueUnrelated',
} as const satisfies Record<SubIssueRelation, string>;
const relations = ['lit', 'blocksLit', 'blockedByLit', 'unrelated'] as const satisfies readonly SubIssueRelation[];

export function SubIssueList({
  issue,
  blocking,
  forge,
  open,
}: {
  issue: IssueDetail;
  blocking: boolean;
  forge: string;
  open(reference: IssueReference): void;
}) {
  const { t } = useLocalization();
  const [unfolded, setUnfolded] = useState(issue.state === 'open');
  const [lit, setLit] = useState<string | null>(null);
  const descriptionId = useId();
  const rows = presentSubIssueRows(issue.subIssues, { lit, blocking });
  const unlisted = issue.subIssueProgress.total - issue.subIssues.length;
  return (
    <section className="forge-box forge-sub-issues" aria-label={t('subIssues')}>
      <header>
        <button className="dispatch-records-toggle" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
          <span aria-hidden>{unfolded ? '▾' : '▸'}</span> {t('subIssues')}
        </button>
        <span className="forge-spacer" />
        <Progress {...issue.subIssueProgress} />
      </header>
      {unfolded && (
        <div className="forge-sub-issue-list" onMouseLeave={() => setLit(null)}>
          {relations.map(relation => (
            <span key={relation} id={`${descriptionId}-${relation}`} hidden>
              {t(relationMessages[relation])}
            </span>
          ))}
          {rows.map(row => (
            <div
              key={row.key}
              className={`forge-sub-issue ${row.issue.state}`}
              data-relation={row.relation ?? undefined}
              onMouseEnter={() => setLit(row.key)}
            >
              <button
                className="forge-sub-issue-open"
                data-hint={`#${row.issue.number} ${row.issue.title}`}
                aria-describedby={row.relation ? `${descriptionId}-${row.relation}` : undefined}
                onFocus={() => setLit(row.key)}
                onBlur={() => setLit(current => (current === row.key ? null : current))}
                onClick={() => open(row.issue)}
              >
                <IssueIcon issue={row.issue} size={12} decorative />
                <span className="forge-row-number">#{row.issue.number}</span>
                <span className="forge-ellipsis">{row.issue.title}</span>
              </button>
              {!!row.openBlockers.length && (
                <BlockedMark
                  by={row.openBlockers.map(blocker => ({ reference: subIssueKey(blocker), title: blocker.title }))}
                  unlisted={row.unlistedBlockers}
                />
              )}
            </div>
          ))}
          {unlisted > 0 && <MoreOnForge message="moreSubIssues" count={unlisted} forge={forge} url={issue.url} />}
        </div>
      )}
    </section>
  );
}
