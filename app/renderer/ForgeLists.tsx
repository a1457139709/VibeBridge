import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BlockedIcon, IssueClosedIcon, IssueOpenedIcon, SkipIcon, SyncIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import { detail } from '../shared/messages';
import type { ForgeCapabilities, ForgeLabel, IssueCounts, IssueListFilter, IssueListPage, IssuePage, IssueState, IssueSummary, ListedIssue, RepositoryReference } from '../shared/forge';
import type { ProjectView } from '../shared/model';

type Tab = 'issues' | 'pullRequests';
const openNoFilter: IssueListFilter = { search: '', state: 'open', labels: [] };
type FailedPage = Extract<IssuePage, { ok: false }>;
/** The rows shown, with the filter that produced them: Load more continues that filter. */
type Loaded = IssueListPage & { filter: IssueListFilter };

/** The sidebar's header: the repository, or that none is bound, and the persistent Refresh. */
export function SidebarHead({ title, refresh, loading = false }: { title: string; refresh?(): void; loading?: boolean }) {
  const { t } = useLocalization();
  return <header className="forge-sidebar-head">
    <span className="forge-sidebar-repository">{title}</span>
    <button className={`forge-refresh ${loading ? 'spinning' : ''}`} aria-label={t('refresh')} data-hint={t('refresh')} aria-busy={loading}
      disabled={loading || !refresh} onClick={refresh}><SyncIcon size={14} /></button>
  </header>;
}

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  /** Opens Edit project with focus on the repository field. */
  editBinding(): void;
}

/** The bound repository's lists: a persistent Refresh, the Issues and Pull requests tabs, each with its own
 * search and filters, and the forge failure states. It holds its own state, so the owner mounts it per project
 * and repository: opening the sidebar or returning to a project starts from open with no filter, and refreshes.
 * Only the current tab is fetched. There is no timed refresh. */
export function ForgeLists({ project, editBinding }: Props) {
  const { t, text } = useLocalization();
  const [tab, setTab] = useState<Tab>('issues');
  const [filters, setFilters] = useState<Record<Tab, IssueListFilter>>({ issues: openNoFilter, pullRequests: openNoFilter });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<FailedPage | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the latest request may settle the list; an older answer is for a filter no longer shown.
  const latest = useRef(0);
  const requested = useRef<IssueListFilter | null>(null);

  async function load(filter: IssueListFilter, cursor: string | null) {
    const request = ++latest.current;
    requested.current = filter;
    setLoading(true);
    let page: IssuePage;
    // A failure outside the forge (the request itself) is shown like a transient one, with its reason and Retry.
    try { page = await window.workbench.issuePage(project.id, { filter, cursor }); }
    catch (error) { page = { ok: false, failure: { kind: 'transient', detail: text((error as Error).message), forge: project.forge }, account: null }; }
    if (request !== latest.current) return;
    setLoading(false);
    if (!page.ok) return setFailed(page);
    const { ok: _, ...next } = page;
    setFailed(null);
    setLoaded(previous => cursor !== null && previous ? { ...next, filter, issues: [...previous.issues, ...next.issues] } : { ...next, filter });
  }
  // Only the Issues tab has a list to refresh; the Pull requests list joins with its own loader.
  const refresh = tab === 'issues' ? () => void load(filters.issues, null) : undefined;

  // The issues tab fetches when it shows and whenever its filter changes; typing in the search settles first.
  useEffect(() => {
    if (tab !== 'issues') return;
    const typing = requested.current !== null && requested.current.search !== filters.issues.search;
    const timer = setTimeout(() => void load(filters.issues, null), typing ? 300 : 0);
    return () => clearTimeout(timer);
  }, [tab, filters.issues]);

  const { forge } = project;
  const retry = <button onClick={refresh} disabled={loading || !refresh}>{t('retry')}</button>;
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
  if (failed && !loaded) return fill(<>
    <p>{t('issuesLoadFailed', { reason: detail(failed.failure.detail || failed.failure.kind) })}</p>{retry}</>);

  const filter = filters[tab];
  const setFilter = (update: (filter: IssueListFilter) => IssueListFilter) => setFilters(all => ({ ...all, [tab]: update(all[tab]) }));
  return <>
    {head}
    {failed && tab === 'issues' && <div className="forge-stale" title={failed.failure.detail}><span>{t('dataMayBeStale')}</span>{retry}</div>}
    <nav className="forge-tabs" role="tablist" aria-label={t('sidebarTabs')}>
      {(['issues', 'pullRequests'] as const).map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'on' : ''}
        onClick={() => setTab(item)}>{t(item === 'issues' ? 'issuesTab' : 'pullRequestsTab')}</button>)}
    </nav>
    <FilterBar key={tab} tab={tab} filter={filter} setFilter={setFilter} labels={loaded?.labels ?? []}
      counts={tab === 'issues' && loaded ? loaded.counts : null} />
    {tab === 'issues' && <div className="forge-scroll">
      {loaded && <IssueTree issues={loaded.issues} state={loaded.filter.state} capabilities={forge.capabilities}
        addLabel={name => setFilter(f => f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] })} />}
      {loaded && !loaded.issues.length && <p className="forge-empty">{t('noMatchingIssues')}</p>}
      {!loaded && <p className="forge-empty">{t('loadingIssues')}</p>}
      {loaded?.cursor && <button className="forge-more" disabled={loading} onClick={() => void load(loaded.filter, loaded.cursor)}>{t('loadMore')}</button>}
    </div>}
  </>;
}

function FilterBar({ tab, filter, setFilter, labels, counts }: {
  tab: Tab; filter: IssueListFilter; setFilter(update: (filter: IssueListFilter) => IssueListFilter): void;
  labels: ForgeLabel[]; counts: IssueCounts | null;
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
    <input type="search" className="forge-search" aria-label={t(tab === 'issues' ? 'searchIssues' : 'searchPullRequests')} placeholder={t('searchListPlaceholder')}
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
 * An expanded parent shows the sub-issues in the listed state; listing open ones, it folds the closed ones. */
function IssueTree({ issues, state, capabilities, addLabel }: {
  issues: ListedIssue[]; state: IssueState; capabilities: ForgeCapabilities; addLabel(name: string): void;
}) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [showingClosed, setShowingClosed] = useState<ReadonlySet<number>>(new Set());
  const flip = (set: ReadonlySet<number>, number: number) => { const next = new Set(set); if (!next.delete(number)) next.add(number); return next; };
  const loaded = new Map(issues.map(issue => [issue.number, issue]));
  const top = capabilities.subIssues ? issues.filter(issue => issue.parent === null || !loaded.has(issue.parent)) : issues;
  /** The forge's sub-issues of a parent with any loaded issue that names it, by number. A loaded one keeps its own sub-issues. */
  const childrenOf = (parent: ListedIssue) => {
    const children = new Map<number, IssueSummary>(parent.subIssues.issues.map(child => [child.number, loaded.get(child.number) ?? child]));
    for (const issue of issues) if (issue.parent === parent.number) children.set(issue.number, issue);
    return [...children.values()].sort((a, b) => a.number - b.number);
  };

  const row = (issue: IssueSummary): React.ReactNode => {
    // Only a loaded issue carries its own sub-issues; a sub-issue the forge listed for its parent shows none.
    const loadedIssue = capabilities.subIssues ? loaded.get(issue.number) : undefined;
    const withSubIssues = loadedIssue && loadedIssue.subIssues.total > 0 ? loadedIssue : null;
    const open = !!withSubIssues && expanded.has(issue.number);
    const children = open ? childrenOf(withSubIssues) : [];
    const folded = state === 'open' ? children.filter(child => child.state === 'closed') : [];
    const showClosed = showingClosed.has(issue.number);
    const shown = children.filter(child => child.state === state || (showClosed && folded.includes(child)));
    return <li key={issue.number}>
      <IssueRow issue={issue} addLabel={addLabel} blocking={capabilities.blocking}
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
 * which stays the same whether or not the issue is blocked. */
function IssueRow({ issue, addLabel, blocking, progress }: { issue: IssueSummary; addLabel(name: string): void; blocking: boolean; progress: React.ReactNode }) {
  return <div className="forge-row">
    <IssueIcon issue={issue} />
    <div className="forge-row-main">
      <div className="forge-row-title">{issue.title}</div>
      <div className="forge-row-meta">
        <span className="forge-row-number">#{issue.number}</span><RelativeTime iso={issue.createdAt} />
        {progress}
        {blocking && !!issue.blockedBy.length && <Blocked by={issue.blockedBy} />}
        {issue.labels.map(label => <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />)}
      </div>
    </div>
    {/* The row's action area, kept for dispatch. */}
    <div className="forge-row-action" />
  </div>;
}

function Progress({ closed, total }: { closed: number; total: number }) {
  const { t } = useLocalization();
  return <span className="forge-progress" data-hint={t('subIssueProgress', { closed, total })}>
    <span className="forge-progress-bar"><span style={{ width: `${closed / total * 100}%` }} /></span>{closed}/{total}</span>;
}

/** The blocked mark as the forge shows it: the blocked icon and the blockers' numbers; hovering names them. */
function Blocked({ by }: { by: IssueSummary['blockedBy'] }) {
  const { t } = useLocalization();
  const reference = (issue: IssueSummary['blockedBy'][number]) => `${issue.path ?? ''}#${issue.number}`;
  const numbers = by.map(reference).join(', ');
  return <span className="forge-blocked" aria-label={t('blockedBy', { issues: numbers })}
    data-hint={by.map(issue => `${reference(issue)} ${issue.title}`).join('\n')}><BlockedIcon size={12} />{numbers}</span>;
}

/** GitHub's own state octicons and colours: open green, completed purple, not planned or duplicate grey. */
function IssueIcon({ issue }: { issue: IssueSummary }) {
  const { t } = useLocalization();
  const [Icon, tone, name] = issue.state === 'open' ? [IssueOpenedIcon, 'open', t('issueOpen')]
    : issue.closedAs === 'notPlanned' ? [SkipIcon, 'skipped', t('issueNotPlanned')]
    : issue.closedAs === 'duplicate' ? [SkipIcon, 'skipped', t('issueDuplicate')]
    : [IssueClosedIcon, 'done', t('issueCompleted')];
  return <span className={`forge-icon forge-${tone}`} role="img" aria-label={name} data-hint={name}><Icon size={16} /></span>;
}

function Label({ label, onClick }: { label: ForgeLabel; onClick(): void }) {
  return <button className="forge-label" style={{ '--label': `#${label.color}` } as CSSProperties}
    onClick={event => { event.stopPropagation(); onClick(); }}>{label.name}</button>;
}

function RelativeTime({ iso }: { iso: string }) {
  const { t, language } = useLocalization();
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  const text = seconds < 60 ? t('justNow')
    : seconds < 3600 ? t('minutesAgo', { count: Math.floor(seconds / 60) })
    : seconds < 86400 ? t('hoursAgo', { count: Math.floor(seconds / 3600) })
    : seconds < 86400 * 30 ? t('daysAgo', { count: Math.floor(seconds / 86400) })
    : date.toLocaleDateString(language);
  return <time dateTime={iso} data-hint={date.toLocaleString(language)}>{text}</time>;
}
