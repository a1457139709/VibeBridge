import { useId, useState } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueReference, SubIssue, SubIssueProgress } from '../../shared/forge/forge';
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
  owner,
  subIssues,
  progress,
  current,
  blocking,
  forge,
  open,
}: {
  owner: IssueReference;
  subIssues: SubIssue[];
  progress: SubIssueProgress;
  current: number | null;
  blocking: boolean;
  forge: string;
  open(reference: IssueReference): void;
}) {
  const { t } = useLocalization();
  const [unfolded, setUnfolded] = useState(current !== null || owner.state === 'open');
  const [pointed, setPointed] = useState<string | null>(null);
  const descriptionId = useId();
  const currentKey = current === null ? null : subIssueKey({ path: null, number: current });
  const rows = presentSubIssueRows(subIssues, { lit: pointed ?? currentKey, blocking });
  const unlisted = progress.total - subIssues.length;
  const heading = t(current === null ? 'subIssues' : 'siblingIssues');
  return (
    <section className="forge-box forge-sub-issues" aria-label={heading}>
      <header>
        <button className="dispatch-records-toggle" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
          <span aria-hidden>{unfolded ? '▾' : '▸'}</span> {heading}
        </button>
        {current !== null && (
          <button className="forge-sub-issue-owner" data-hint={owner.title} onClick={() => open(owner)}>
            <IssueIcon issue={owner} size={11} decorative />
            <span className="forge-row-number">#{owner.number}</span>
            <span className="forge-ellipsis">{owner.title}</span>
          </button>
        )}
        <span className="forge-spacer" />
        <Progress {...progress} />
      </header>
      {unfolded && (
        <div className="forge-sub-issue-list" onMouseLeave={() => setPointed(null)}>
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
              onMouseEnter={() => setPointed(row.key)}
            >
              <button
                className="forge-sub-issue-open"
                data-hint={`#${row.issue.number} ${row.issue.title}`}
                aria-describedby={row.relation ? `${descriptionId}-${row.relation}` : undefined}
                aria-current={row.key === currentKey || undefined}
                onFocus={() => setPointed(row.key)}
                onBlur={() => setPointed(shown => (shown === row.key ? null : shown))}
                onClick={() => row.key !== currentKey && open(row.issue)}
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
          {unlisted > 0 && <MoreOnForge message="moreSubIssues" count={unlisted} forge={forge} url={owner.url} />}
        </div>
      )}
    </section>
  );
}
