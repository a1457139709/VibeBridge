import { useEffect, useRef, useState } from 'react';
import type { IssueSummary, PlatformDescription, SubIssuesResult } from '../shared/code-hosting';
import type { Language, PanelCreation, ProjectView } from '../shared/model';
import type { DispatchLocation, DispatchRequest } from '../shared/dispatch';
import type { WorkflowSettings } from '../shared/workflows';
import type { Shortcuts } from '../shared/shortcuts';
import { DispatchMenu, DispatchStatus, issueShortcutKeys, type DispatchMenuActions } from './Dispatch';
import { issueRowKeyDown } from './issue-navigation';
import { useLocalization } from './Localization';
import { LabelButtons, relativeTime, type DetailOpening } from './list-row-parts';
import { BlockedMark, IssueStateIcon } from './issue-icons';
import { ReadFailureState, useLatestRead, type ReadFailure } from './platform-failure';

// An issue's row in the sidebar's issue list, with its sub-issues expanding under it.

/** How a row dispatches its issue and finds where earlier dispatches went. */
export interface Dispatching {
  project: ProjectView; workflows: WorkflowSettings; shortcuts: Shortcuts; locate(location: DispatchLocation): void; filled(location: DispatchLocation): void;
  dispatch(request: DispatchRequest): Promise<PanelCreation | null>;
}

/** The detail opening, plus the one row Tab reaches, how a focused row claims that and how an expanded issue reports the sub-issue rows it shows. */
export interface RowFocus extends DetailOpening { tabbable?: number; focused(number: number): void; showing(parent: number, rows: number[] | null): void }

/** What every issue row of the list shares. */
export interface IssueRowContext {
  platform: PlatformDescription; language: Language; addLabel(name: string): void; dispatching: Dispatching; detail: RowFocus;
  readSubIssues(number: number): Promise<SubIssuesResult>;
}

/** The issue's sub-issues, read while they are shown and afresh whenever the list reads the issue again. */
function useSubIssues(issue: IssueSummary, shown: boolean, read: IssueRowContext['readSubIssues']) {
  const [state, setState] = useState<{ issues?: IssueSummary[]; failure?: ReadFailure }>({});
  const latestRead = useLatestRead();
  const load = () => latestRead(read(issue.number), result => setState(current => result.ok ? { issues: result.issues } : { ...current, failure: result }));
  useEffect(() => { if (shown) load(); }, [shown, issue]);
  return { ...state, retry: () => { setState({}); load(); } };
}

/** Clicking the row opens the issue's detail; its controls and dispatch actions act on their own. */
export function IssueRow({ issue, context }: { issue: IssueSummary; context: IssueRowContext }) {
  const { platform, language, addLabel, dispatching, detail } = context;
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(false);
  const created = new Date(issue.createdAt);
  const subIssues = platform.capabilities.includes('subIssues') ? issue.subIssues : null;
  const children = useSubIssues(issue, !!subIssues && expanded, context.readSubIssues);
  const menu = useRef<DispatchMenuActions>(null);
  const records = dispatching.project.dispatches.filter(record => record.issue === issue.number);
  const shortcutKeys = issueShortcutKeys({ issue, records, shortcuts: dispatching.shortcuts, menu, locate: dispatching.locate });
  // The dispatch and locate shortcuts come first; the row's fixed keys leave any key they handled.
  return <li aria-label={`#${issue.number} ${issue.title}`} aria-current={detail.opened === issue.number || undefined}
    data-issue-row={issue.number} tabIndex={detail.tabbable === issue.number ? 0 : -1}
    onFocus={event => { if (event.target === event.currentTarget) detail.focused(issue.number); }}
    onKeyDown={event => { shortcutKeys(event); issueRowKeyDown(event, { expandable: !!subIssues, expanded, setExpanded, open: () => detail.open(issue.number) }); }}>
    <div className="issue-row" onClick={event => { if (!(event.target as Element).closest('button, a, .issue-row-actions')) detail.open(issue.number); }}>
      <IssueStateIcon issue={issue} />
      <div className="issue-row-main">
        <div className="issue-row-title">{issue.title}</div>
        <div className="issue-row-meta">
          <span className="issue-row-number">#{issue.number}</span>
          <time dateTime={issue.createdAt} title={created.toLocaleString(language)}>{relativeTime(created, language)}</time>
          {subIssues && <button className="issue-progress" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}
            aria-label={t('subIssueProgress', { completed: subIssues.completed, total: subIssues.total })}>
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            <span className="issue-progress-bar"><span style={{ width: `${subIssues.completed / subIssues.total * 100}%` }} /></span>
            {subIssues.completed}/{subIssues.total}</button>}
          {platform.capabilities.includes('nativeBlocking') && (issue.blockedBy.length > 0 || issue.moreBlockers > 0) && <BlockedMark blockers={issue.blockedBy} more={issue.moreBlockers} />}
          <LabelButtons labels={issue.labels} addLabel={addLabel} />
        </div>
      </div>
      <div className="issue-row-actions">
        <DispatchMenu ref={menu} issue={issue} project={dispatching.project} workflows={dispatching.workflows} dispatch={dispatching.dispatch} filled={dispatching.filled} />
        <DispatchStatus issue={issue} records={records} locate={dispatching.locate} />
      </div>
    </div>
    {subIssues && expanded && (children.failure
      ? <div className="issue-sub-issues"><ReadFailureState failure={children.failure} unreachable={t('itemUnreachable', { number: issue.number })} retry={children.retry} /></div>
      : children.issues ? <SubIssueList parent={issue.number} issues={children.issues} context={context} />
      : <p className="issue-sub-issues issue-sub-issues-loading" role="status">{t('loadingSubIssues')}</p>)}
  </li>;
}

/** Sub-issues in number order; the closed ones fold behind one button. */
function SubIssueList({ parent, issues, context }: { parent: number; issues: IssueSummary[]; context: IssueRowContext }) {
  const { t } = useLocalization();
  const [showClosed, setShowClosed] = useState(false);
  const closed = issues.filter(issue => issue.state === 'closed').length;
  const shown = issues.filter(issue => showClosed || issue.state === 'open').sort((a, b) => a.number - b.number);
  const rows = shown.map(issue => issue.number).join();
  const { showing } = context.detail;
  useEffect(() => {
    showing(parent, rows ? rows.split(',').map(Number) : []);
    return () => showing(parent, null);
  }, [parent, rows]);
  return <div className="issue-sub-issues">
    <ul aria-label={t('subIssuesOf', { number: parent })}>
      {shown.map(issue => <IssueRow key={issue.number} issue={issue} context={context} />)}
    </ul>
    {closed > 0 && <button className="issue-closed-fold" onClick={() => setShowClosed(open => !open)}>
      {showClosed ? t('hideClosedSubIssues') : t('closedSubIssues', { count: closed })}</button>}
  </div>;
}
