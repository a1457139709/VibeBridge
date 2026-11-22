import { useState } from 'react';
import { useLocalization } from '../common/Localization';
import type {
  ForgeCapabilities,
  IssueSummary,
  ListState,
  ListedIssue,
  PullRequestSummary,
} from '../../shared/forge/forge';
import {
  BlockedMark,
  IssueIcon,
  Label,
  OpenPullRequestChecks,
  Progress,
  PullRequestIcon,
  RelativeTime,
} from './ForgeDisplay';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { withoutShortcutModifier } from '../../shared/settings/shortcuts';
import { VirtualRows, type VirtualRowsHost } from './VirtualRows';
import { requireClosest, requireValue } from '../common/required';

const rowTitleClass = 'forge-row-title',
  rowTitleSelector = `.${rowTitleClass}`;
const rowAttribute = { issue: 'data-issue', pullRequest: 'data-pull-request' } as const;
export const rowTitleIn = (scope: Element | null | undefined) => scope?.querySelector<HTMLElement>(rowTitleSelector);
export const rowTitleOf = (scope: Element | null | undefined, item: DetailItem) =>
  rowTitleIn(scope?.querySelector(`[${rowAttribute[item.kind]}="${item.number}"]`));
export function issueRowOf(element: Element | null | undefined) {
  const row = element?.closest<HTMLElement>(`[${rowAttribute.issue}]`);
  return row ? { row, number: Number(row.dataset.issue) } : undefined;
}

export function listRowOf(element: Element) {
  const row = element.closest(`[${rowAttribute.issue}], [${rowAttribute.pullRequest}]`);
  if (!row) return null;
  const issue = row.getAttribute(rowAttribute.issue);
  const item: DetailItem = issue
    ? { kind: 'issue', number: Number(issue) }
    : { kind: 'pullRequest', number: Number(row.getAttribute(rowAttribute.pullRequest)) };
  return { row, item };
}

const keyedRowTitle = (event: React.KeyboardEvent) => {
  const { target } = event;
  return target instanceof HTMLElement && target.matches(rowTitleSelector) && withoutShortcutModifier(event)
    ? target
    : null;
};

export function moveOrOpenRow(event: React.KeyboardEvent<HTMLElement>) {
  const title = keyedRowTitle(event);
  if (!title) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const titles = [...event.currentTarget.querySelectorAll<HTMLElement>(rowTitleSelector)];
    titles[titles.indexOf(title) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  } else if (event.key === ' ' || event.key === 'Enter') title.click();
  else return;
  event.preventDefault();
}

export function IssueTree({
  rowsHost,
  issues,
  listState,
  capabilities,
  selected,
  open: openIssue,
  addLabel,
  renderAction,
}: {
  rowsHost: VirtualRowsHost;
  issues: ListedIssue[];
  listState: ListState;
  capabilities: ForgeCapabilities;
  renderAction(issue: IssueSummary): React.ReactNode;
  selected: number | undefined;
  open(number: number): void;
  addLabel(name: string): void;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [showingClosed, setShowingClosed] = useState<ReadonlySet<number>>(new Set());
  const flip = (set: ReadonlySet<number>, number: number) => {
    const next = new Set(set);
    if (!next.delete(number)) next.add(number);
    return next;
  };
  const loaded = new Map(issues.map(issue => [issue.number, issue]));
  const loadedChildren = new Map<number, ListedIssue[]>();
  for (const issue of issues)
    if (issue.parent !== null) loadedChildren.set(issue.parent, [...(loadedChildren.get(issue.parent) ?? []), issue]);
  const top = capabilities.subIssues
    ? issues.filter(issue => issue.parent === null || !loaded.has(issue.parent))
    : issues;
  const childrenOf = (parent: ListedIssue) => {
    const children = new Map<number, IssueSummary>(
      parent.subIssues.issues.map(child => [child.number, loaded.get(child.number) ?? child]),
    );
    for (const issue of loadedChildren.get(parent.number) ?? []) children.set(issue.number, issue);
    return [...children.values()].sort((a, b) => a.number - b.number);
  };

  const row = (issue: IssueSummary): React.ReactNode => {
    const loadedIssue = capabilities.subIssues ? loaded.get(issue.number) : undefined;
    const children = loadedIssue ? childrenOf(loadedIssue) : [];
    const listed = children.filter(child => child.state === listState);
    const folded = listState === 'open' ? children.filter(child => child.state === 'closed') : [];
    const withSubIssues = loadedIssue && (listed.length || folded.length) ? loadedIssue : null;
    const isExpanded = !!withSubIssues && expanded.has(issue.number);
    const showClosed = showingClosed.has(issue.number);
    const shown = showClosed ? [...listed, ...folded] : listed;
    return (
      <li key={issue.number}>
        <IssueRow
          issue={issue}
          selected={issue.number === selected}
          open={() => openIssue(issue.number)}
          addLabel={addLabel}
          blocking={capabilities.blocking}
          renderAction={renderAction}
          progress={
            withSubIssues && (
              <button
                className={`forge-progress-toggle ${isExpanded ? 'on' : ''}`}
                aria-expanded={isExpanded}
                aria-label={t(isExpanded ? 'hideSubIssues' : 'showSubIssues')}
                data-hint={t(isExpanded ? 'hideSubIssues' : 'showSubIssues')}
                onClick={event => {
                  event.stopPropagation();
                  setExpanded(set => flip(set, issue.number));
                }}
              >
                <span className="forge-progress-caret">{isExpanded ? '▾' : '▸'}</span>
                <Progress {...withSubIssues.subIssues} />
              </button>
            )
          }
        />
        {isExpanded && (
          <div className="forge-sub-issues" role="group" aria-label={t('subIssuesOf', { number: issue.number })}>
            <ul className="forge-rows">{shown.map(row)}</ul>
            {!!folded.length && (
              <button className="forge-fold" onClick={() => setShowingClosed(set => flip(set, issue.number))}>
                {showClosed ? t('hideClosedSubIssues') : t('closedSubIssues', { count: folded.length })}
              </button>
            )}
          </div>
        )}
      </li>
    );
  };
  const keydown = (event: React.KeyboardEvent) => {
    const title = keyedRowTitle(event);
    if (!title || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const item = requireClosest(title, 'li');
    const { number } = requireValue(issueRowOf(title), 'the issue row');
    const parent = !!item.querySelector(':scope > .forge-row .forge-progress-toggle');
    const isExpanded = parent && expanded.has(number);
    if (event.key === 'ArrowLeft') {
      if (isExpanded) rowTitleIn(item.querySelector(':scope > .forge-sub-issues .forge-row'))?.focus();
      else if (parent) setExpanded(set => flip(set, number));
    } else if (isExpanded) setExpanded(set => flip(set, number));
    else
      rowTitleIn(
        requireValue(item.parentElement, 'the issue list').closest('li')?.querySelector(':scope > .forge-row'),
      )?.focus();
  };
  return (
    <VirtualRows
      host={rowsHost}
      keys={top.map(issue => issue.number)}
      row={index => row(top[index])}
      className="forge-rows"
      aria-label={t('issuesTab')}
      onKeyDown={keydown}
    />
  );
}

function IssueRow({
  issue,
  selected,
  open,
  addLabel,
  blocking,
  progress,
  renderAction,
}: {
  issue: IssueSummary;
  selected: boolean;
  open(): void;
  addLabel(name: string): void;
  blocking: boolean;
  progress: React.ReactNode;
  renderAction(issue: IssueSummary): React.ReactNode;
}) {
  return (
    <div
      className={`forge-row ${selected ? 'selected' : ''}`}
      {...{ [rowAttribute.issue]: issue.number }}
      onClick={open}
    >
      <IssueIcon issue={issue} />
      <div className="forge-row-main">
        <button className={rowTitleClass} aria-current={selected || undefined}>
          {issue.title}
        </button>
        <div className="forge-row-meta">
          <span className="forge-row-number">#{issue.number}</span>
          <RelativeTime iso={issue.createdAt} />
          {progress}
          {blocking && !!(issue.blockedBy.length || issue.unlistedBlockers) && (
            <BlockedMark
              by={issue.blockedBy.map(blocker => ({
                reference: `${blocker.path ?? ''}#${blocker.number}`,
                title: blocker.title,
              }))}
              unlisted={issue.unlistedBlockers}
            />
          )}
          {issue.labels.map(label => (
            <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />
          ))}
        </div>
      </div>
      {issue.state === 'open' && <div className="forge-row-action">{renderAction(issue)}</div>}
    </div>
  );
}

export function PullRequestRow({
  pullRequest,
  selected,
  open,
  addLabel,
}: {
  pullRequest: PullRequestSummary;
  selected: boolean;
  open(): void;
  addLabel(name: string): void;
}) {
  return (
    <div
      className={`forge-row ${selected ? 'selected' : ''}`}
      {...{ [rowAttribute.pullRequest]: pullRequest.number }}
      onClick={open}
    >
      <PullRequestIcon state={pullRequest.state} />
      <div className="forge-row-main">
        <button className={rowTitleClass} aria-current={selected || undefined}>
          {pullRequest.title}
        </button>
        <div className="forge-row-meta">
          <span className="forge-row-number">#{pullRequest.number}</span>
          <RelativeTime iso={pullRequest.createdAt} />
          {pullRequest.author && <span className="forge-author">{pullRequest.author}</span>}
          <OpenPullRequestChecks state={pullRequest.state} checks={pullRequest.checks} />
          {pullRequest.labels.map(label => (
            <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />
          ))}
        </div>
      </div>
    </div>
  );
}
