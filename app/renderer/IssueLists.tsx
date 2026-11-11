import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DesktopAPI } from '../shared/api';
import { defaultListFilter, platformDescriptions, type ListFilter, type IssueLabel, type IssueSummary, type ListFailure, type MergeRequestSummary, type PlatformDescription,
  type RepositoryReference } from '../shared/code-hosting';
import type { ProjectView } from '../shared/model';
import type { DispatchLocation } from '../shared/dispatch';
import type { WorkflowSettings } from '../shared/workflows';
import type { Shortcuts } from '../shared/shortcuts';
import { entryRow } from './issue-navigation';
import { useLocalization } from './Localization';
import type { DetailOpening } from './list-row-parts';
import { MergeRequestRow } from './MergeRequestRow';
import { IssueRow, type Dispatching, type IssueRowContext } from './IssueRow';
import { ReadFailureState, useLatestRead, type ReadFailure } from './platform-failure';

/** The sidebar's lists, one per tab. */
type SidebarList = 'issues' | 'mergeRequests';
/** Each list's search and filters. */
export type ListFilters = Record<SidebarList, ListFilter>;
export const unfiltered: ListFilters = { issues: defaultListFilter, mergeRequests: defaultListFilter };
type Failure = ListFailure | ReadFailure;

/**
 * The bound repository's lists. Mounted while the sidebar is open on one project and binding,
 * so opening the sidebar or returning to a project reads afresh. Each tab keeps its own filters,
 * held by the sidebar; only the shown tab reads from the platform.
 */
export function IssueLists({ project, repository, changes = 0, refreshed, filters, setFilters, workflows, shortcuts, changeBinding, locate, filled, detail, mergeRequestDetail, api = window.workbench }: {
  project: ProjectView; repository: RepositoryReference; workflows: WorkflowSettings; shortcuts: Shortcuts; changeBinding(): void;
  /** Counts the changes made outside the list; each one refreshes the shown list. */
  changes?: number;
  /** The shown list began reading its first page afresh. */
  refreshed(): void;
  filters: ListFilters; setFilters(update: (filters: ListFilters) => ListFilters): void;
  /** Shows the panel a dispatch went to. */
  locate(location: DispatchLocation): void;
  /** Shows the panel an instruction was just filled into, with input going to it. */
  filled(location: DispatchLocation): void;
  /** Which issue's and which merge request's detail is open, and how rows open them. */
  detail: DetailOpening;
  mergeRequestDetail: DetailOpening;
  api?: Pick<DesktopAPI, 'issuePage' | 'mergeRequestPage' | 'dispatch' | 'subIssues'>;
}) {
  const { t, language } = useLocalization();
  const [tab, setTab] = useState<SidebarList>('issues');
  // The row last focused is the one Tab reaches in the list, while it is shown.
  const [focused, setFocused] = useState<number>();
  // The sub-issue rows each expanded issue shows, by its number.
  const [nested, setNested] = useState<Record<number, number[]>>({});
  const showing = (parent: number, rows: number[] | null) => setNested(current => {
    const { [parent]: _, ...rest } = current;
    return rows ? { ...rest, [parent]: rows } : rest;
  });
  const setFilter = (filter: ListFilter) => setFilters(current => ({ ...current, [tab]: filter }));
  const tabs = <div className="issue-tabs" role="tablist">
    {(['issues', 'mergeRequests'] as const).map(id => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {t(id === 'issues' ? 'issuesTab' : 'mergeRequestsTab')}</button>)}
  </div>;
  const platform = platformDescriptions[repository.platform];
  const common = { tabs, setFilter, repository, changeBinding, changes, refreshed };
  return tab === 'issues'
    ? <ListTab key="issues" {...common} filter={filters.issues} search={t('searchIssues')} empty={t('noMatchingIssues')}
      load={(filter, cursor) => api.issuePage(project.id, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.issues, next: result.page.next, labels: result.page.labels } } : result)}
      rows={(issues: IssueSummary[], addLabel, refresh) => {
        // The list refreshes once after each dispatch.
        const dispatching: Dispatching = { project, workflows, shortcuts, locate, filled,
          dispatch: request => api.dispatch(project.id, request).then(creation => { refresh(); return creation; }) };
        const shown = topLevel(issues, platform);
        const reachable = new Set(shown.map(issue => issue.number));
        for (const number of reachable) for (const sub of nested[number] ?? []) reachable.add(sub);
        const tabbable = focused !== undefined && reachable.has(focused) ? focused : shown[0]?.number;
        const context: IssueRowContext = { platform, language, addLabel, dispatching, detail: { ...detail, tabbable, focused: setFocused, showing },
          readSubIssues: number => api.subIssues(project.id, number) };
        return shown.map(issue => <IssueRow key={issue.number} issue={issue} context={context} />);
      }} />
    : <ListTab key="mergeRequests" {...common} filter={filters.mergeRequests} search={t('searchMergeRequests')} empty={t('noMatchingMergeRequests')}
      load={(filter, cursor) => api.mergeRequestPage(project.id, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.mergeRequests, next: result.page.next, labels: result.page.labels } } : result)}
      rows={(requests: MergeRequestSummary[], addLabel) => requests.map(request =>
        <MergeRequestRow key={request.number} request={request} addLabel={addLabel} detail={mergeRequestDetail} />)} />;
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
function useListPages<Item>(filter: ListFilter, changes: number, refreshed: () => void, load: (filter: ListFilter, cursor: string | null) => Promise<ListResult<Item>>) {
  const [state, setState] = useState<ListState<Item>>({ loading: 'refresh' });
  const latestRead = useLatestRead();
  const read = (cursor: string | null) => {
    if (!cursor) refreshed();
    setState(current => ({ ...current, loading: cursor ? 'more' : 'refresh' }));
    latestRead(load(filter, cursor), result => setState(current => result.ok
      ? { loading: null, page: cursor && current.page ? { ...result.page, items: [...current.page.items, ...result.page.items] } : result.page }
      : { ...current, loading: null, failure: result }));
  };
  useEffect(() => { read(null); }, [filter, changes]);
  return { ...state, refresh: () => read(null), more: () => { if (state.page?.next) read(state.page.next); } };
}

/** One tab's list: refresh, filters, rows, paging and the failure states, the same for every kind of item. */
function ListTab<Item>({ tabs, filter, setFilter, load, rows, search, empty, repository, changeBinding, changes, refreshed }: {
  tabs: ReactNode; filter: ListFilter; setFilter(filter: ListFilter): void; repository: RepositoryReference; changeBinding(): void; changes: number; refreshed(): void;
  load(filter: ListFilter, cursor: string | null): Promise<ListResult<Item>>;
  rows(items: Item[], addLabel: (name: string) => void, refresh: () => void): ReactNode; search: string; empty: string;
}) {
  const { t } = useLocalization();
  const list = useListPages(filter, changes, refreshed, load);
  const items = useRef<HTMLDivElement>(null);
  // Focus resting on the sidebar itself, as opening it by shortcut leaves it, enters the list once rows are shown.
  useLayoutEffect(() => {
    const container = items.current;
    if (container && document.activeElement === container.closest('.issue-sidebar')) entryRow(container)?.focus();
  }, [list.page]);
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
    <div className="issue-list" ref={items}>
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
function FilterBar({ filter, setFilter, labels, search }: { filter: ListFilter; setFilter(filter: ListFilter): void; labels: IssueLabel[]; search: string }) {
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

function LabelSwatch({ label }: { label: IssueLabel }) {
  return <span className="issue-label-swatch" style={{ background: `#${label.color}` }} />;
}

/** Why the bound repository cannot be listed, filling the sidebar's content area. */
export function FailureState({ failure, path, retry, changeBinding }: { failure: Failure; path: string; retry(): void; changeBinding(): void }) {
  const { t } = useLocalization();
  const account = 'account' in failure ? failure.account : undefined;
  const unreachable = account ? t('repositoryUnreachable', { path, account }) : t('repositoryUnreachableAnonymous', { path });
  return <ReadFailureState failure={failure} unreachable={unreachable} retry={retry}
    actions={'failure' in failure && failure.failure.kind === 'unreachable' && <button onClick={changeBinding}>{t('changeBinding')}</button>} />;
}
