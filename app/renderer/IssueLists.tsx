import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesktopAPI } from '../shared/api';
import { defaultIssueFilter, platformDescriptions, type IssueFilter, type IssueLabel, type IssueReference, type IssueSummary, type ListFailure, type MergeRequestSummary, type PlatformDescription, type RepositoryReference } from '../shared/code-hosting';
import type { Language, ProjectView } from '../shared/model';
import type { DispatchLocation, DispatchRequest } from '../shared/dispatch';
import type { WorkflowSettings } from '../shared/workflows';
import { DispatchMenu, DispatchStatus } from './Dispatch';
import { useLocalization } from './Localization';
import { LabelButtons, relativeTime } from './list-row-parts';
import { MergeRequestRow } from './MergeRequestRow';

type Tab = 'issues' | 'mergeRequests';
type Failure = ListFailure | { ok: false; error: string };

/**
 * The bound repository's lists. Mounted while the sidebar is open on one project and binding,
 * so opening the sidebar or returning to a project reads afresh from an open, unfiltered list.
 * Each tab keeps its own filters; only the shown tab reads from the platform.
 */
export function IssueLists({ project, repository, workflows, changeBinding, locate, detail, api = window.workbench }: {
  project: ProjectView; repository: RepositoryReference; workflows: WorkflowSettings; changeBinding(): void;
  /** Shows the panel a dispatch went to. */
  locate(location: DispatchLocation): void;
  detail: IssueDetailOpening;
  api?: Pick<DesktopAPI, 'issuePage' | 'mergeRequestPage' | 'dispatch'>;
}) {
  const { t, language } = useLocalization();
  const [tab, setTab] = useState<Tab>('issues');
  const [filters, setFilters] = useState<Record<Tab, IssueFilter>>({ issues: defaultIssueFilter, mergeRequests: defaultIssueFilter });
  const setFilter = (filter: IssueFilter) => setFilters(current => ({ ...current, [tab]: filter }));
  const tabs = <div className="issue-tabs" role="tablist">
    {(['issues', 'mergeRequests'] as const).map(id => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {t(id === 'issues' ? 'issuesTab' : 'mergeRequestsTab')}</button>)}
  </div>;
  const platform = platformDescriptions[repository.platform];
  const common = { tabs, setFilter, repository, changeBinding };
  return tab === 'issues'
    ? <ListTab key="issues" {...common} filter={filters.issues} search={t('searchIssues')} empty={t('noMatchingIssues')}
      load={(filter, cursor) => api.issuePage(project.id, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.issues, next: result.page.next, labels: result.page.labels } } : result)}
      rows={(issues: IssueSummary[], addLabel, refresh) => {
        // The list refreshes once after each dispatch.
        const dispatching: Dispatching = { project, workflows, locate, dispatch: request => api.dispatch(project.id, request).then(refresh) };
        return topLevel(issues, platform).map(issue =>
          <IssueRow key={issue.number} issue={issue} platform={platform} language={language} addLabel={addLabel} dispatching={dispatching} detail={detail} />);
      }} />
    : <ListTab key="mergeRequests" {...common} filter={filters.mergeRequests} search={t('searchMergeRequests')} empty={t('noMatchingMergeRequests')}
      load={(filter, cursor) => api.mergeRequestPage(project.id, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.mergeRequests, next: result.page.next, labels: result.page.labels } } : result)}
      rows={(requests: MergeRequestSummary[], addLabel) => requests.map(request =>
        <MergeRequestRow key={request.number} request={request} addLabel={addLabel} />)} />;
}

interface Dispatching {
  project: ProjectView; workflows: WorkflowSettings; locate(location: DispatchLocation): void; dispatch(request: DispatchRequest): Promise<void>;
}

/** A list page whatever the list holds. */
interface ListPage<Item> { items: Item[]; next: string | null; labels: IssueLabel[] }
type ListResult<Item> = { ok: true; page: ListPage<Item> } | ListFailure;

interface ListState<Item> {
  page?: ListPage<Item>;
  loading: 'refresh' | 'more' | null;
  failure?: Failure;
}

/** Reads the first page whenever the filter changes and on refresh; later pages append. A request superseded by another is ignored. */
function useListPages<Item>(filter: IssueFilter, load: (filter: IssueFilter, cursor: string | null) => Promise<ListResult<Item>>) {
  const [state, setState] = useState<ListState<Item>>({ loading: 'refresh' });
  const latest = useRef(0);
  const read = (cursor: string | null) => {
    const request = ++latest.current;
    setState(current => ({ ...current, loading: cursor ? 'more' : 'refresh' }));
    load(filter, cursor).then(result => result, (error: Error) => ({ ok: false, error: error.message }) as const).then(result => {
      if (request !== latest.current) return;
      setState(current => result.ok
        ? { loading: null, page: cursor && current.page ? { ...result.page, items: [...current.page.items, ...result.page.items] } : result.page }
        : { ...current, loading: null, failure: result });
    });
  };
  useEffect(() => { read(null); }, [filter]);
  return { ...state, refresh: () => read(null), more: () => { if (state.page?.next) read(state.page.next); } };
}

/** One tab's list: refresh, filters, rows, paging and the failure states, the same for every kind of item. */
function ListTab<Item>({ tabs, filter, setFilter, load, rows, search, empty, repository, changeBinding }: {
  tabs: ReactNode; filter: IssueFilter; setFilter(filter: IssueFilter): void; repository: RepositoryReference; changeBinding(): void;
  load(filter: IssueFilter, cursor: string | null): Promise<ListResult<Item>>;
  rows(items: Item[], addLabel: (name: string) => void, refresh: () => void): ReactNode; search: string; empty: string;
}) {
  const { t } = useLocalization();
  const list = useListPages(filter, load);
  const platform = platformDescriptions[repository.platform];
  const addLabel = (name: string) => { if (!filter.labels.includes(name)) setFilter({ ...filter, labels: [...filter.labels, name] }); };
  // A transient failure leaves rows already read in place; any other failure, or one before any rows, fills the content area.
  const stale = list.failure && 'failure' in list.failure && list.failure.failure.kind === 'transient' && list.page;
  const toolbar = <div className="issue-toolbar">{tabs}<RefreshButton busy={!!list.loading} onClick={list.refresh} /></div>;
  if (list.failure && !stale) {
    return <div className="issue-tab">{toolbar}
      <FailureState failure={list.failure} path={repository.path} retry={list.refresh} changeBinding={changeBinding} /></div>;
  }
  return <div className="issue-tab">
    {toolbar}
    {stale && <div className="issue-stale" role="status"><span>{t('listMayBeStale')}</span>
      <button disabled={!!list.loading} onClick={list.refresh}>{t('retry')}</button></div>}
    <FilterBar filter={filter} setFilter={setFilter} labels={list.page?.labels ?? []} search={search} />
    <div className="issue-list">
      {list.page && <ul aria-label={platform.name}>{rows(list.page.items, addLabel, list.refresh)}</ul>}
      {list.page && !list.page.items.length && !list.loading && <p className="issue-list-empty">{empty}</p>}
      {list.page?.next && <button className="issue-list-more" disabled={!!list.loading} onClick={list.more}>{t('loadMore')}</button>}
    </div>
  </div>;
}

function RefreshButton({ busy, disabled = busy, onClick }: { busy: boolean; disabled?: boolean; onClick(): void }) {
  const { t } = useLocalization();
  return <button className="issue-refresh" aria-label={t('refreshList')} aria-busy={busy} disabled={disabled} onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" /></svg>
  </button>;
}

/** The search is sent when Enter is pressed; the state and labels apply at once. */
function FilterBar({ filter, setFilter, labels, search }: { filter: IssueFilter; setFilter(filter: IssueFilter): void; labels: IssueLabel[]; search: string }) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState(filter.search);
  const [menu, setMenu] = useState(false);
  const toggleLabel = (name: string) => setFilter({ ...filter, labels: filter.labels.includes(name) ? filter.labels.filter(label => label !== name) : [...filter.labels, name] });
  return <div className="issue-filters">
    <input type="search" aria-label={search} placeholder={t('searchIssuePlaceholder')} value={draft} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setFilter({ ...filter, search: draft.trim() }); } }} />
    <div className="issue-filter-row">
      {(['open', 'closed'] as const).map(state => <button key={state} className="issue-state-filter" aria-pressed={filter.state === state}
        onClick={() => { if (filter.state !== state) setFilter({ ...filter, state }); }}>{t(state === 'open' ? 'openIssues' : 'closedIssues')}</button>)}
      <div className="issue-label-menu">
        <button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}>{t('labelsFilter')}</button>
        {menu && <div role="menu" aria-label={t('labelsFilter')} onKeyDown={event => { if (event.key === 'Escape') setMenu(false); }}>
          {labels.length ? labels.map(label => <button key={label.name} role="menuitemcheckbox" aria-checked={filter.labels.includes(label.name)}
            onClick={() => toggleLabel(label.name)}><LabelSwatch label={label} />{label.name}</button>)
            : <p>{t('noLabels')}</p>}
        </div>}
      </div>
      {filter.labels.map(name => <button key={name} className="issue-label-chosen" aria-label={t('removeLabelFilter', { label: name })}
        onClick={() => toggleLabel(name)}>{name} ×</button>)}
    </div>
  </div>;
}

/** The issues listed at the top level: those whose parent is not listed. Where the platform has no sub-issues, every issue. */
function topLevel(issues: IssueSummary[], platform: PlatformDescription) {
  if (!platform.capabilities.includes('subIssues')) return issues;
  const listed = new Set(issues.map(issue => issue.number));
  return issues.filter(issue => issue.parent === null || !listed.has(issue.parent));
}

/** Which issue's detail is open, and how a row opens one. */
interface IssueDetailOpening { opened?: number; open(number: number): void }

/** Clicking the row opens the issue's detail; its controls and dispatch actions act on their own. */
function IssueRow({ issue, platform, language, addLabel, dispatching, detail }: {
  issue: IssueSummary; platform: PlatformDescription; language: Language; addLabel(name: string): void; dispatching: Dispatching; detail: IssueDetailOpening;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(false);
  const created = new Date(issue.createdAt);
  const subIssues = platform.capabilities.includes('subIssues') ? issue.subIssues : null;
  return <li aria-label={`#${issue.number} ${issue.title}`} aria-current={detail.opened === issue.number || undefined}>
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
          {platform.capabilities.includes('nativeBlocking') && issue.blockedBy.length > 0 && <BlockedMark blockers={issue.blockedBy} />}
          <LabelButtons labels={issue.labels} addLabel={addLabel} />
        </div>
      </div>
      <div className="issue-row-actions">
        <DispatchMenu issue={issue} project={dispatching.project} workflows={dispatching.workflows} dispatch={dispatching.dispatch} locate={dispatching.locate} />
        <DispatchStatus issue={issue} records={dispatching.project.dispatches.filter(record => record.issue === issue.number)} locate={dispatching.locate} />
      </div>
    </div>
    {subIssues && expanded && <SubIssueList parent={issue.number} issues={subIssues.issues} platform={platform} language={language} addLabel={addLabel} dispatching={dispatching} detail={detail} />}
  </li>;
}

/** Sub-issues in number order; the closed ones fold behind one button. */
function SubIssueList({ parent, issues, platform, language, addLabel, dispatching, detail }: {
  parent: number; issues: IssueSummary[]; platform: PlatformDescription; language: Language; addLabel(name: string): void; dispatching: Dispatching;
  detail: IssueDetailOpening;
}) {
  const { t } = useLocalization();
  const [showClosed, setShowClosed] = useState(false);
  const closed = issues.filter(issue => issue.state === 'closed').length;
  const shown = issues.filter(issue => showClosed || issue.state === 'open').sort((a, b) => a.number - b.number);
  return <div className="issue-sub-issues">
    <ul aria-label={t('subIssuesOf', { number: parent })}>
      {shown.map(issue => <IssueRow key={issue.number} issue={issue} platform={platform} language={language} addLabel={addLabel} dispatching={dispatching} detail={detail} />)}
    </ul>
    {closed > 0 && <button className="issue-closed-fold" onClick={() => setShowClosed(open => !open)}>
      {showClosed ? t('hideClosedSubIssues') : t('closedSubIssues', { count: closed })}</button>}
  </div>;
}

/** GitHub's blocked octicon and the blockers' numbers; hovering names them. */
function BlockedMark({ blockers }: { blockers: IssueReference[] }) {
  const { t } = useLocalization();
  const numbers = blockers.map(blocker => `#${blocker.number}`).join(', ');
  return <span className="issue-blocked" role="img" aria-label={t('blockedBy', { numbers })}
    title={blockers.map(blocker => `#${blocker.number} ${blocker.title}`).join('\n')}>
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4.467.22a.749.749 0 0 1 .53-.22h6.006c.199 0 .389.079.53.22l4.247 4.247c.141.14.22.331.22.53v6.006a.749.749 0 0 1-.22.53l-4.247 4.247a.749.749 0 0 1-.53.22H4.997a.749.749 0 0 1-.53-.22L.22 11.533a.749.749 0 0 1-.22-.53V4.997c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.308v5.384l3.807 3.808h5.384l3.808-3.808V5.308L10.692 1.5ZM4 7.75A.75.75 0 0 1 4.75 7h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 7.75Z" /></svg>
    <span aria-hidden="true">{numbers}</span>
  </span>;
}

function LabelSwatch({ label }: { label: IssueLabel }) {
  return <span className="issue-label-swatch" style={{ background: `#${label.color}` }} />;
}

// GitHub's own octicons: issue-opened, issue-closed and skip.
const stateIcons = {
  open: ['M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z'],
  completed: ['M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z', 'M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z'],
  skipped: ['M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z'],
};

export function IssueStateIcon({ issue }: { issue: Pick<IssueSummary, 'state' | 'closedAs'> }) {
  const { t } = useLocalization();
  const [icon, name] = issue.state === 'open' ? ['open', t('issueOpen')] as const
    : issue.closedAs === 'notPlanned' ? ['skipped', t('issueNotPlanned')] as const
    : issue.closedAs === 'duplicate' ? ['skipped', t('issueDuplicate')] as const
    : issue.closedAs === 'completed' ? ['completed', t('issueCompleted')] as const
    : ['completed', t('issueClosed')] as const;
  return <svg className={`issue-state issue-state-${icon}`} role="img" aria-label={name} viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    {stateIcons[icon].map(path => <path key={path} d={path} />)}
  </svg>;
}

function FailureState({ failure, path, retry, changeBinding }: { failure: Failure; path: string; retry(): void; changeBinding(): void }) {
  const { t, text } = useLocalization();
  const [copied, setCopied] = useState(false);
  const retryButton = <button onClick={retry}>{t('retry')}</button>;
  if ('error' in failure) return <div className="issue-sidebar-state" role="alert"><p>{text(failure.error)}</p>{retryButton}</div>;
  const { kind, platform, output } = failure.failure;
  if (kind === 'notInstalled') return <div className="issue-sidebar-state" role="alert">
    <p>{t('platformCliMissing', { platform: platform.name })}</p>
    <p>{t('installFrom')} <a href={platform.installUrl} target="_blank" rel="noreferrer">{platform.installUrl}</a></p>
    {retryButton}
  </div>;
  if (kind === 'signedOut') return <div className="issue-sidebar-state" role="alert">
    <p>{t('platformSignInNeeded', { platform: platform.name })}</p>
    <div className="issue-state-actions">
      <button aria-label={t('copyCommand', { command: platform.signInCommand })}
        onClick={() => { void navigator.clipboard.writeText(platform.signInCommand).then(() => setCopied(true)); }}>
        <code>{platform.signInCommand}</code>{copied ? ` · ${t('copied')}` : ''}</button>
      {retryButton}
    </div>
  </div>;
  if (kind === 'unreachable') return <div className="issue-sidebar-state" role="alert">
    <p>{failure.account ? t('repositoryUnreachable', { path, account: failure.account }) : t('repositoryUnreachableAnonymous', { path })}</p>
    <div className="issue-state-actions">{retryButton}<button onClick={changeBinding}>{t('changeBinding')}</button></div>
  </div>;
  return <div className="issue-sidebar-state" role="alert">
    <p>{t('listReadFailed', { platform: platform.name, reason: output || kind })}</p>
    {retryButton}
  </div>;
}
