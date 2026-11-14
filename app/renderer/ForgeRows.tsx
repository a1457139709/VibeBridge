import { useState } from 'react';
import { useLocalization } from './Localization';
import type { ForgeCapabilities, IssueSummary, ListState, ListedIssue, PullRequestSummary } from '../shared/forge';
import { BlockedMark, IssueIcon, Label, OpenChecks, Progress, PullRequestIcon, RelativeTime } from './ForgeDisplay';

/** The loaded issues as a tree, when the forge has sub-issues: an issue sits under its parent when the parent is
 * loaded, else at the top level. Parents start collapsed; their progress button expands them without fetching.
 * An expanded parent shows the sub-issues in the listed state; listing open ones, it folds the closed ones after them.
 * A parent shows the button only when it has sub-issues to show, as the list holds them. */
export function IssueTree({ issues, state, capabilities, selected, open: openIssue, addLabel, action }: {
  issues: ListedIssue[]; state: ListState; capabilities: ForgeCapabilities;
  /** The action area of an open issue's row. */
  action(issue: IssueSummary): React.ReactNode;
  /** The issue the detail shows, if any. */
  selected: number | undefined;
  open(number: number): void; addLabel(name: string): void;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [showingClosed, setShowingClosed] = useState<ReadonlySet<number>>(new Set());
  const flip = (set: ReadonlySet<number>, number: number) => { const next = new Set(set); if (!next.delete(number)) next.add(number); return next; };
  const loaded = new Map(issues.map(issue => [issue.number, issue]));
  const loadedChildren = new Map<number, ListedIssue[]>();
  for (const issue of issues) if (issue.parent !== null) loadedChildren.set(issue.parent, [...loadedChildren.get(issue.parent) ?? [], issue]);
  const top = capabilities.subIssues ? issues.filter(issue => issue.parent === null || !loaded.has(issue.parent)) : issues;
  /** The forge's sub-issues of a parent with any loaded issue that names it, by number. A loaded one keeps its own sub-issues. */
  const childrenOf = (parent: ListedIssue) => {
    const children = new Map<number, IssueSummary>(parent.subIssues.issues.map(child => [child.number, loaded.get(child.number) ?? child]));
    for (const issue of loadedChildren.get(parent.number) ?? []) children.set(issue.number, issue);
    return [...children.values()].sort((a, b) => a.number - b.number);
  };

  const row = (issue: IssueSummary): React.ReactNode => {
    // Only a loaded issue carries its own sub-issues; a sub-issue the forge listed for its parent shows none.
    const loadedIssue = capabilities.subIssues ? loaded.get(issue.number) : undefined;
    const children = loadedIssue ? childrenOf(loadedIssue) : [];
    const listed = children.filter(child => child.state === state);
    const folded = state === 'open' ? children.filter(child => child.state === 'closed') : [];
    const withSubIssues = loadedIssue && (listed.length || folded.length) ? loadedIssue : null;
    const open = !!withSubIssues && expanded.has(issue.number);
    const showClosed = showingClosed.has(issue.number);
    const shown = showClosed ? [...listed, ...folded] : listed;
    return <li key={issue.number}>
      <IssueRow issue={issue} selected={issue.number === selected} open={() => openIssue(issue.number)} addLabel={addLabel} blocking={capabilities.blocking} action={action}
        progress={withSubIssues && <button className={`forge-progress-toggle ${open ? 'on' : ''}`} aria-expanded={open}
          aria-label={t(open ? 'hideSubIssues' : 'showSubIssues')} data-hint={t(open ? 'hideSubIssues' : 'showSubIssues')}
          onClick={event => { event.stopPropagation(); setExpanded(set => flip(set, issue.number)); }}>
          <span className="forge-progress-caret">{open ? '▾' : '▸'}</span><Progress {...withSubIssues.subIssues} /></button>} />
      {open && <div className="forge-sub-issues" role="group" aria-label={t('subIssuesOf', { number: issue.number })}>
        <ul className="forge-rows">{shown.map(row)}</ul>
        {!!folded.length && <button className="forge-fold" onClick={() => setShowingClosed(set => flip(set, issue.number))}>
          {showClosed ? t('hideClosedSubIssues') : t('closedSubIssues', { count: folded.length })}</button>}
      </div>}
    </li>;
  };
  return <ul className="forge-rows" aria-label={t('issuesTab')}>{top.map(row)}</ul>;
}

/** A list row: state, title, number, age, the sub-issue progress, the blocked mark and the labels, and the action area
 * (Dispatch and the latest dispatch's status), which stays the same whether or not the issue is blocked. The row opens its issue's detail wherever it is clicked;
 * its title is the button that does so from the keyboard. */
function IssueRow({ issue, selected, open, addLabel, blocking, progress, action }: {
  issue: IssueSummary; selected: boolean; open(): void; addLabel(name: string): void; blocking: boolean; progress: React.ReactNode;
  action(issue: IssueSummary): React.ReactNode;
}) {
  return <div className={`forge-row ${selected ? 'selected' : ''}`} data-issue={issue.number} onClick={open}>
    <IssueIcon issue={issue} />
    <div className="forge-row-main">
      <button className="forge-row-title" aria-current={selected || undefined}>{issue.title}</button>
      <div className="forge-row-meta">
        <span className="forge-row-number">#{issue.number}</span><RelativeTime iso={issue.createdAt} />
        {progress}
        {blocking && !!(issue.blockedBy.length || issue.unlistedBlockers) && <BlockedMark by={issue.blockedBy.map(blocker => ({ reference: `${blocker.path ?? ''}#${blocker.number}`, title: blocker.title }))} unlisted={issue.unlistedBlockers} />}
        {issue.labels.map(label => <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />)}
      </div>
    </div>
    {/* An open issue is dispatched from here; a closed one shows no dispatch. */}
    {issue.state === 'open' && <div className="forge-row-action">{action(issue)}</div>}
  </div>;
}

/** A pull request row: state, title, number, age, author, the checks conclusion while it is open, and the labels.
 * It has no action area: pull requests are not dispatched. Like an issue row, it opens its detail wherever it is clicked. */
export function PullRequestRow({ pullRequest, selected, open, addLabel }: { pullRequest: PullRequestSummary; selected: boolean; open(): void; addLabel(name: string): void }) {
  return <div className={`forge-row ${selected ? 'selected' : ''}`} onClick={open}>
    <PullRequestIcon state={pullRequest.state} />
    <div className="forge-row-main">
      <button className="forge-row-title" aria-current={selected || undefined}>{pullRequest.title}</button>
      <div className="forge-row-meta">
        <span className="forge-row-number">#{pullRequest.number}</span><RelativeTime iso={pullRequest.createdAt} />
        {pullRequest.author && <span className="forge-author">{pullRequest.author}</span>}
        <OpenChecks state={pullRequest.state} checks={pullRequest.checks} />
        {pullRequest.labels.map(label => <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />)}
      </div>
    </div>
  </div>;
}
