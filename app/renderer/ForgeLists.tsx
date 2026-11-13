import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { IssueClosedIcon, IssueOpenedIcon, SkipIcon, SyncIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import { detail } from '../shared/messages';
import type { ForgeLabel, IssueCounts, IssueListFilter, IssueListPage, IssuePage, IssueSummary, RepositoryReference } from '../shared/forge';
import type { ProjectView } from '../shared/model';
import { IssueDetailPane } from './IssueDetail';

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
 * search and filters, and the forge failure states. It holds its own state, so the owner mounts it per project
 * and repository: opening the sidebar or returning to a project starts from open with no filter, and refreshes.
 * Only the current tab is fetched. There is no timed refresh. Clicking a row opens its detail beside the list; links
 * followed inside the detail stack up, so Back returns to the issue before. */
export function ForgeLists({ project, editBinding, detailHost }: Props) {
  const { t, text } = useLocalization();
  const [tab, setTab] = useState<Tab>('issues');
  const [filters, setFilters] = useState<Record<Tab, IssueListFilter>>({ issues: openNoFilter, pullRequests: openNoFilter });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<FailedPage | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the latest request may settle the list; an older answer is for a filter no longer shown.
  const latest = useRef(0);
  const requested = useRef<IssueListFilter | null>(null);
  /** The issues opened in the detail, the shown one last; empty when the detail is closed. */
  const [opened, setOpened] = useState<number[]>([]);
  const shownIssue = opened.at(-1);
  const detailOpen = shownIssue !== undefined;
  useEffect(() => { detailHost.shown(detailOpen); }, [detailOpen]);
  useEffect(() => () => detailHost.shown(false), []);
  const openIssue = (number: number) => setOpened(stack => stack.at(-1) === number ? stack : [...stack, number]);

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
      {loaded && <ul className="forge-rows" aria-label={t('issuesTab')}>
        {loaded.issues.map(issue => <IssueRow key={issue.number} issue={issue} selected={issue.number === shownIssue} open={() => setOpened([issue.number])}
          addLabel={name => setFilter(f => f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] })} />)}
      </ul>}
      {loaded && !loaded.issues.length && <p className="forge-empty">{t('noMatchingIssues')}</p>}
      {!loaded && <p className="forge-empty">{t('loadingIssues')}</p>}
      {loaded?.cursor && <button className="forge-more" disabled={loading} onClick={() => void load(loaded.filter, loaded.cursor)}>{t('loadMore')}</button>}
    </div>}
    {shownIssue !== undefined && <IssueDetailPane project={project} number={shownIssue} width={detailHost.width} resize={detailHost.resize}
      canBack={opened.length > 1} back={() => setOpened(stack => stack.slice(0, -1))} close={() => setOpened([])} open={openIssue} />}
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

/** A row opens its issue's detail wherever it is clicked; its title is the button that does so from the keyboard. */
function IssueRow({ issue, selected, open, addLabel }: { issue: IssueSummary; selected: boolean; open(): void; addLabel(name: string): void }) {
  return <li className={`forge-row ${selected ? 'selected' : ''}`} onClick={open}>
    <IssueIcon issue={issue} />
    <div className="forge-row-main">
      <button className="forge-row-title" aria-current={selected || undefined}>{issue.title}</button>
      <div className="forge-row-meta">
        <span className="forge-row-number">#{issue.number}</span><RelativeTime iso={issue.createdAt} />
        {issue.labels.map(label => <Label key={label.name} label={label} onClick={() => addLabel(label.name)} />)}
      </div>
    </div>
    {/* The row's action area, kept for dispatch. */}
    <div className="forge-row-action" />
  </li>;
}

/** How an issue stands: open, or closed as completed, not planned or a duplicate (completed when the forge does not tell). */
export const issueState = (issue: Pick<IssueSummary, 'state' | 'closedAs'>) => issue.state === 'open' ? 'open' as const : issue.closedAs ?? 'completed';
/** Each state's octicon and colour, as the forge shows them (open green, completed purple, not planned or duplicate grey),
 * with the name an icon gives it and the shorter one a state pill shows. */
export const issueStates = {
  open: { Icon: IssueOpenedIcon, tone: 'open', name: 'issueOpen', short: 'stateOpen' },
  completed: { Icon: IssueClosedIcon, tone: 'done', name: 'issueCompleted', short: 'stateCompleted' },
  notPlanned: { Icon: SkipIcon, tone: 'skipped', name: 'issueNotPlanned', short: 'stateNotPlanned' },
  duplicate: { Icon: SkipIcon, tone: 'skipped', name: 'issueDuplicate', short: 'stateDuplicate' },
} as const;

/** An issue's state octicon in the forge's colour. A decorative icon sits next to text that already names the state. */
export function IssueIcon({ issue, size = 16, decorative = false }: { issue: Pick<IssueSummary, 'state' | 'closedAs'>; size?: number; decorative?: boolean }) {
  const { t } = useLocalization();
  const { Icon, tone, name } = issueStates[issueState(issue)];
  return decorative ? <span className={`forge-icon forge-${tone}`}><Icon size={size} /></span>
    : <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)} data-hint={t(name)}><Icon size={size} /></span>;
}

/** A label in the forge's colour; with `onClick` it is a button. */
export function Label({ label, onClick }: { label: ForgeLabel; onClick?(): void }) {
  const style = { '--label': `#${label.color}` } as CSSProperties;
  return onClick ? <button className="forge-label clickable" style={style} onClick={event => { event.stopPropagation(); onClick(); }}>{label.name}</button>
    : <span className="forge-label" style={style}>{label.name}</span>;
}

export function RelativeTime({ iso }: { iso: string }) {
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
