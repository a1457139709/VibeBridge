import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SyncIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import { detail } from '../shared/messages';
import type { ForgeCapabilities, ForgeLabel, IssueSummary, ListCounts, ListFilter, ListPage, ListState, ListedIssue, Page, PullRequestSummary, RepositoryReference } from '../shared/forge';
import type { ProjectView } from '../shared/model';
import { IssueDetailPane } from './IssueDetail';
import { BlockedMark, IssueIcon, Label, OpenChecks, Progress, PullRequestIcon, RelativeTime } from './ForgeDisplay';

/** The sidebar's lists, each a tab. */
interface Items { issues: ListedIssue; pullRequests: PullRequestSummary }
type Tab = keyof Items;
const tabs: Tab[] = ['issues', 'pullRequests'];
/** Each tab's own texts. */
const tabText = {
  issues: { name: 'issuesTab', search: 'searchIssues', loadFailed: 'issuesLoadFailed', noMatches: 'noMatchingIssues', loading: 'loadingIssues' },
  pullRequests: { name: 'pullRequestsTab', search: 'searchPullRequests', loadFailed: 'pullRequestsLoadFailed', noMatches: 'noMatchingPullRequests', loading: 'loadingPullRequests' },
} as const;
const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
type FailedPage = Extract<Page<unknown>, { ok: false }>;
/** A tab's rows, with the filter that produced them: Load more continues that filter. */
type Loaded<T extends Tab> = ListPage<Items[T]> & { filter: ListFilter };
/** What a tab last loaded, and its failure since then. */
interface TabList<T extends Tab> { loaded: Loaded<T> | null; failed: FailedPage | null }
type Lists = { [T in Tab]: TabList<T> };
const empty = { loaded: null, failed: null };
const pageOf: { [T in Tab]: (projectId: string, query: { filter: ListFilter; cursor: string | null }) => Promise<Page<Items[T]>> } = {
  issues: (projectId, query) => window.workbench.issuePage(projectId, query),
  pullRequests: (projectId, query) => window.workbench.pullRequestPage(projectId, query),
};

/** The sidebar's header: the repository, or that none is bound, and the persistent Refresh. */
export function SidebarHead({ title, refresh, loading = false }: { title: string; refresh?(): void; loading?: boolean }) {
  const { t } = useLocalization();
  return <header className="forge-sidebar-head">
    <span className="forge-sidebar-repository">{title}</span>
    <button className={`forge-refresh ${loading ? 'spinning' : ''}`} aria-label={t('refresh')} data-hint={t('refresh')} aria-busy={loading}
      disabled={loading || !refresh} onClick={refresh}><SyncIcon size={14} /></button>
  </header>;
}

/** The detail's width and resize edge, owned by the sidebar, and where it reports whether a detail is open. */
export interface DetailHost {
  width: number;
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  shown(open: boolean): void;
}

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  /** Opens Edit project with focus on the repository field. */
  editBinding(): void;
  detailHost: DetailHost;
}

/** The bound repository's lists: a persistent Refresh, the Issues and Pull requests tabs, each with its own
 * search, filters, rows and failure, and the forge failure states. It holds its own state, so the owner mounts it per
 * project and repository: opening the sidebar or returning to a project starts from open with no filter, and refreshes.
 * Only the current tab is fetched, each time it shows. There is no timed refresh. Clicking an issue row opens its detail
 * beside the list; links followed inside the detail stack up, so Back returns to the issue before. */
export function ForgeLists({ project, editBinding, detailHost }: Props) {
  const { t, text } = useLocalization();
  const [tab, setTab] = useState<Tab>('issues');
  const [filters, setFilters] = useState<Record<Tab, ListFilter>>({ issues: openNoFilter, pullRequests: openNoFilter });
  const [lists, setLists] = useState<Lists>({ issues: empty, pullRequests: empty });
  const [loading, setLoading] = useState(false);
  // Only the latest request may settle a list; an older answer is for a filter or tab no longer shown.
  const latest = useRef(0);
  const requested = useRef<Record<Tab, ListFilter | null>>({ issues: null, pullRequests: null });
  /** The issues opened in the detail, the shown one last; empty when the detail is closed. */
  const [opened, setOpened] = useState<number[]>([]);
  const shownIssue = opened.at(-1);
  const detailOpen = shownIssue !== undefined;
  useEffect(() => { detailHost.shown(detailOpen); return () => detailHost.shown(false); }, [detailOpen]);
  const openIssue = (number: number) => setOpened(stack => stack.at(-1) === number ? stack : [...stack, number]);

  async function load<T extends Tab>(list: T, filter: ListFilter, cursor: string | null) {
    const request = ++latest.current;
    requested.current[list] = filter;
    setLoading(true);
    let page: Page<Items[T]>;
    // A failure outside the forge (the request itself) is shown like a transient one, with its reason and Retry.
    try { page = await pageOf[list](project.id, { filter, cursor }); }
    catch (error) { page = { ok: false, failure: { kind: 'transient', detail: text((error as Error).message), forge: project.forge }, account: null }; }
    if (request !== latest.current) return;
    setLoading(false);
    const settle = (update: (state: TabList<T>) => TabList<T>) => setLists(all => ({ ...all, [list]: update(all[list] as TabList<T>) }));
    if (!page.ok) return settle(state => ({ ...state, failed: page }));
    const { ok: _, ...next } = page;
    settle(({ loaded: previous }) => ({ failed: null,
      loaded: cursor !== null && previous ? { ...next, filter, items: [...previous.items, ...next.items] } : { ...next, filter } }));
  }
  const refresh = () => void load(tab, filters[tab], null);

  // The current tab fetches when it shows and whenever its filter changes; typing in the search settles first.
  useEffect(() => {
    const filter = filters[tab], last = requested.current[tab];
    const typing = last !== null && last.search !== filter.search;
    const timer = setTimeout(() => void load(tab, filter, null), typing ? 300 : 0);
    return () => clearTimeout(timer);
  }, [tab, filters[tab]]);

  const { forge } = project;
  const { loaded, failed } = lists[tab];
  const retry = <button onClick={refresh} disabled={loading}>{t('retry')}</button>;
  const head = <SidebarHead title={project.repository.path} refresh={refresh} loading={loading} />;
  const fill = (body: React.ReactNode) => <>{head}<div className="forge-sidebar-state">{body}</div></>;

  if (failed?.failure.kind === 'notInstalled') return fill(<>
    <p>{t('forgeCliMissing', { cli: forge.cli })}</p>
    <a href={forge.installUrl} target="_blank" rel="noreferrer">{t('installInstructions')}</a>{retry}</>);
  if (failed?.failure.kind === 'loggedOut') return fill(<>
    <p>{t('forgeCliLoggedOut', { cli: forge.cli })}</p>
    <button onClick={() => void navigator.clipboard.writeText(forge.loginCommand)}>{t('copyCommand', { command: forge.loginCommand })}</button>{retry}</>);
  if (failed?.failure.kind === 'inaccessible') return fill(<>
    <p>{failed.account === null ? t('repositoryInaccessibleNoAccount', { repository: project.repository.path, cli: forge.cli })
      : t('repositoryInaccessible', { repository: project.repository.path, cli: forge.cli, account: failed.account })}</p>
    {retry}<button onClick={editBinding}>{t('changeBinding')}</button></>);
  const texts = tabText[tab];
  if (failed && !loaded) return fill(<>
    <p>{t(texts.loadFailed, { reason: detail(failed.failure.detail || failed.failure.kind) })}</p>{retry}</>);

  const filter = filters[tab];
  const setFilter = (update: (filter: ListFilter) => ListFilter) => setFilters(all => ({ ...all, [tab]: update(all[tab]) }));
  const addLabel = (name: string) => setFilter(f => f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] });
  return <>
    {head}
    {failed && <div className="forge-stale" title={failed.failure.detail}><span>{t('dataMayBeStale')}</span>{retry}</div>}
    <nav className="forge-tabs" role="tablist" aria-label={t('sidebarTabs')}>
      {tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'on' : ''}
        onClick={() => setTab(item)}>{t(tabText[item].name)}</button>)}
    </nav>
    <FilterBar key={tab} tab={tab} filter={filter} setFilter={setFilter} labels={loaded?.labels ?? []} counts={loaded?.counts ?? null} />
    <div className="forge-scroll">
      {lists.issues.loaded && tab === 'issues' && <IssueTree issues={lists.issues.loaded.items} state={lists.issues.loaded.filter.state}
        capabilities={project.capabilities} selected={shownIssue} open={number => setOpened([number])} addLabel={addLabel} />}
      {lists.pullRequests.loaded && tab === 'pullRequests' && <ul className="forge-rows" aria-label={t(texts.name)}>
        {lists.pullRequests.loaded.items.map(item => <li key={item.number}><PullRequestRow pullRequest={item} addLabel={addLabel} /></li>)}</ul>}
      {loaded && !loaded.items.length && <p className="forge-empty">{t(texts.noMatches)}</p>}
      {!loaded && <p className="forge-empty">{t(texts.loading)}</p>}
      {loaded?.cursor && <button className="forge-more" disabled={loading} onClick={() => void load(tab, loaded.filter, loaded.cursor)}>{t('loadMore')}</button>}
    </div>
    {shownIssue !== undefined && <IssueDetailPane project={project} number={shownIssue} width={detailHost.width} resize={detailHost.resize}
      canBack={opened.length > 1} back={() => setOpened(stack => stack.slice(0, -1))} close={() => setOpened([])} open={openIssue} />}
  </>;
}

function FilterBar({ tab, filter, setFilter, labels, counts }: {
  tab: Tab; filter: ListFilter; setFilter(update: (filter: ListFilter) => ListFilter): void;
  labels: ForgeLabel[]; counts: ListCounts | null;
}) {
  const { t } = useLocalization();
  const [choosing, setChoosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!choosing) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setChoosing(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setChoosing(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [choosing]);
  const toggle = (name: string) => setFilter(f => ({ ...f, labels: f.labels.includes(name) ? f.labels.filter(label => label !== name) : [...f.labels, name] }));
  const colors = new Map(labels.map(label => [label.name, label.color]));
  return <div className="forge-filters">
    <input type="search" className="forge-search" aria-label={t(tabText[tab].search)} placeholder={t('searchListPlaceholder')}
      autoComplete="off" value={filter.search} onChange={event => { const search = event.target.value; setFilter(f => ({ ...f, search })); }} />
    <div className="forge-filter-row">
      {(['open', 'closed'] as const).map(state => <button key={state} className={`forge-state ${filter.state === state ? 'on' : ''}`} aria-pressed={filter.state === state}
        onClick={() => setFilter(f => ({ ...f, state }))}>{t(state === 'open' ? 'filterOpen' : 'filterClosed')}{counts && <> <span>{counts[state]}</span></>}</button>)}
      <span className="forge-spacer" />
      <div className="forge-popover-root" ref={root}>
        <button className={`forge-text-button ${filter.labels.length ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={choosing} onClick={() => setChoosing(open => !open)}>
          {t('labelsFilter')}{filter.labels.length ? ` ${filter.labels.length}` : ''} ▾</button>
        {choosing && <div className="forge-popover" role="menu" aria-label={t('labelsFilter')}>
          {labels.map(label => <button key={label.name} role="menuitemcheckbox" aria-checked={filter.labels.includes(label.name)} onClick={() => toggle(label.name)}>
            <span className="forge-swatch" style={{ background: `#${label.color}` }} /><span className="forge-ellipsis">{label.name}</span><b>{filter.labels.includes(label.name) ? '✓' : ''}</b></button>)}
          {!!filter.labels.length && <button className="forge-popover-clear" role="menuitem" onClick={() => setFilter(f => ({ ...f, labels: [] }))}>{t('clearLabels')}</button>}
        </div>}
      </div>
    </div>
    {!!filter.labels.length && <div className="forge-active-labels">
      {filter.labels.map(name => <Label key={name} label={{ name, color: colors.get(name) ?? '888888' }} onClick={() => toggle(name)} />)}<span>{t('removeLabelHint')}</span></div>}
  </div>;
}

/** The loaded issues as a tree, when the forge has sub-issues: an issue sits under its parent when the parent is
 * loaded, else at the top level. Parents start collapsed; their progress button expands them without fetching.
 * An expanded parent shows the sub-issues in the listed state; listing open ones, it folds the closed ones after them.
 * A parent shows the button only when it has sub-issues to show, as the list holds them. */
function IssueTree({ issues, state, capabilities, selected, open: openIssue, addLabel }: {
  issues: ListedIssue[]; state: ListState; capabilities: ForgeCapabilities;
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
      <IssueRow issue={issue} selected={issue.number === selected} open={() => openIssue(issue.number)} addLabel={addLabel} blocking={capabilities.blocking}
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

/** A list row: state, title, number, age, the sub-issue progress, the blocked mark and the labels, and the action area,
 * which stays the same whether or not the issue is blocked. The row opens its issue's detail wherever it is clicked;
 * its title is the button that does so from the keyboard. */
function IssueRow({ issue, selected, open, addLabel, blocking, progress }: {
  issue: IssueSummary; selected: boolean; open(): void; addLabel(name: string): void; blocking: boolean; progress: React.ReactNode;
}) {
  return <div className={`forge-row ${selected ? 'selected' : ''}`} onClick={open}>
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
    {/* The row's action area, kept for dispatching an open issue. */}
    {issue.state === 'open' && <div className="forge-row-action" />}
  </div>;
}

/** A pull request row: state, title, number, age, author, the checks conclusion while it is open, and the labels.
 * It has no action area: pull requests are not dispatched. */
function PullRequestRow({ pullRequest, addLabel }: { pullRequest: PullRequestSummary; addLabel(name: string): void }) {
  return <div className="forge-row static">
    <PullRequestIcon state={pullRequest.state} />
    <div className="forge-row-main">
      <div className="forge-row-title">{pullRequest.title}</div>
      <div className="forge-row-meta">
        <span className="forge-row-number">#{pullRequest.number}</span><RelativeTime iso={pullRequest.createdAt} />
        {pullRequest.author && <span className="forge-author">{pullRequest.author}</span>}
        <OpenChecks state={pullRequest.state} checks={pullRequest.checks} />
        {pullRequest.labels.map(label => <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />)}
      </div>
    </div>
  </div>;
}
