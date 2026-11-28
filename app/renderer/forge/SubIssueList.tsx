import { useId, useState, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type { IssueReference, SubIssue, SubIssueProgress } from '../../shared/forge/forge';
import { BlockedMark, IssueIcon, MoreOnForge, Progress } from './ForgeDisplay';
import { presentSubIssueRows, subIssueKey, type SubIssueRelation } from './sub-issue-rows';
import './sub-issue-list.css';

const relationMessages = {
  highlighted: 'subIssueHighlighted',
  blocksHighlighted: 'subIssueBlocksHighlighted',
  blockedByHighlighted: 'subIssueBlockedByHighlighted',
  unrelated: 'subIssueUnrelated',
} as const satisfies Record<SubIssueRelation, string>;
export function relatedIssueRowOf(element: Element | null | undefined) {
  const row = element?.closest<HTMLElement>('[data-related-issue]');
  if (!row) return undefined;
  return { row, number: row.dataset.relatedPath ? null : Number(row.dataset.relatedIssue) };
}

export interface RelatedDispatch {
  button(issue: SubIssue): ReactNode;
  openMenu(issueNumber: number): void;
}

export type SubIssueListKind = { kind: 'subIssues' } | { kind: 'siblings'; current: number };

export function SubIssueList({
  owner,
  subIssues,
  progress,
  list,
  blocking,
  forge,
  dispatch,
  open,
}: {
  owner: IssueReference;
  subIssues: SubIssue[];
  progress: SubIssueProgress;
  list: SubIssueListKind;
  blocking: boolean;
  forge: string;
  dispatch: RelatedDispatch;
  open(reference: IssueReference): void;
}) {
  const { t } = useLocalization();
  const [unfolded, setUnfolded] = useState(list.kind === 'siblings' || owner.state === 'open');
  const [pointed, setPointed] = useState<string | null>(null);
  const descriptionId = useId();
  const currentKey = list.kind === 'siblings' ? subIssueKey({ path: null, number: list.current }) : null;
  const rows = presentSubIssueRows(subIssues, { highlighted: pointed ?? currentKey, current: currentKey, blocking });
  const unlisted = progress.total - subIssues.length;
  const heading = t(list.kind === 'subIssues' ? 'subIssues' : 'siblingIssues');
  return (
    <section className="forge-box forge-sub-issues" aria-label={heading}>
      <header>
        <button className="forge-sub-issues-toggle" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
          <span aria-hidden>{unfolded ? '▾' : '▸'}</span> {heading}
        </button>
        {list.kind === 'siblings' && (
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
          {Object.entries(relationMessages).map(([relation, message]) => (
            <span key={relation} id={`${descriptionId}-${relation}`} hidden>
              {t(message)}
            </span>
          ))}
          {rows.map(row => (
            <div
              key={row.key}
              className={`forge-sub-issue ${row.issue.state}`}
              data-relation={row.relation ?? undefined}
              data-related-issue={row.issue.number}
              data-related-path={row.issue.path ?? undefined}
              onMouseEnter={() => setPointed(row.key)}
              onContextMenu={event => {
                if (!row.dispatchable) return;
                event.preventDefault();
                dispatch.openMenu(row.issue.number);
              }}
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
              {row.dispatchable && <span className="forge-sub-issue-dispatch">{dispatch.button(row.issue)}</span>}
            </div>
          ))}
          {unlisted > 0 && <MoreOnForge message="moreSubIssues" count={unlisted} forge={forge} url={owner.url} />}
        </div>
      )}
    </section>
  );
}
