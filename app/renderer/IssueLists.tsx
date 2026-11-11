import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DesktopAPI } from '../shared/api';
import { defaultIssueFilter, platformDescriptions, type CheckConclusion, type IssueFilter, type IssueLabel, type IssueSummary, type ListFailure, type MergeRequestSummary, type RepositoryReference } from '../shared/code-hosting';
import type { Language } from '../shared/model';
import { useLocalization } from './Localization';

type Tab = 'issues' | 'mergeRequests';
type Failure = ListFailure | { ok: false; error: string };

/**
 * The bound repository's lists. Mounted while the sidebar is open on one project and binding,
 * so opening the sidebar or returning to a project reads afresh from an open, unfiltered list.
 * Each tab keeps its own filters; only the shown tab reads from the platform.
 */
export function IssueLists({ projectId, repository, changeBinding, api = window.workbench }: {
  projectId: string; repository: RepositoryReference; changeBinding(): void; api?: Pick<DesktopAPI, 'issuePage' | 'mergeRequestPage'>;
}) {
  const { t, language } = useLocalization();
  const [tab, setTab] = useState<Tab>('issues');
  const [filters, setFilters] = useState<Record<Tab, IssueFilter>>({ issues: defaultIssueFilter, mergeRequests: defaultIssueFilter });
  const setFilter = (filter: IssueFilter) => setFilters(current => ({ ...current, [tab]: filter }));
  const tabs = <div className="issue-tabs" role="tablist">
    {(['issues', 'mergeRequests'] as const).map(id => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
      {t(id === 'issues' ? 'issuesTab' : 'mergeRequestsTab')}</button>)}
  </div>;
  const common = { tabs, setFilter, repository, changeBinding };
  return tab === 'issues'
    ? <ListTab key="issues" {...common} filter={filters.issues} search={t('searchIssues')} empty={t('noMatchingIssues')}
      load={(filter, cursor) => api.issuePage(projectId, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.issues, next: result.page.next, labels: result.page.labels } } : result)}
      row={(issue: IssueSummary, addLabel) => <IssueRow key={issue.number} issue={issue} language={language} addLabel={addLabel} />} />
    : <ListTab key="mergeRequests" {...common} filter={filters.mergeRequests} search={t('searchMergeRequests')} empty={t('noMatchingMergeRequests')}
      load={(filter, cursor) => api.mergeRequestPage(projectId, filter, cursor).then(result => result.ok
        ? { ok: true, page: { items: result.page.mergeRequests, next: result.page.next, labels: result.page.labels } } : result)}
      row={(request: MergeRequestSummary, addLabel) => <MergeRequestRow key={request.number} request={request} addLabel={addLabel} />} />;
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
function ListTab<Item>({ tabs, filter, setFilter, load, row, search, empty, repository, changeBinding }: {
  tabs: ReactNode; filter: IssueFilter; setFilter(filter: IssueFilter): void; repository: RepositoryReference; changeBinding(): void;
  load(filter: IssueFilter, cursor: string | null): Promise<ListResult<Item>>;
  row(item: Item, addLabel: (name: string) => void): ReactNode; search: string; empty: string;
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
      {list.page && <ul aria-label={platform.name}>{list.page.items.map(item => row(item, addLabel))}</ul>}
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

function IssueRow({ issue, language, addLabel }: { issue: IssueSummary; language: Language; addLabel(name: string): void }) {
  const created = new Date(issue.createdAt);
  return <li className="issue-row" aria-label={`#${issue.number} ${issue.title}`}>
    <IssueStateIcon issue={issue} />
    <div className="issue-row-main">
      <div className="issue-row-title">{issue.title}</div>
      <div className="issue-row-meta">
        <span className="issue-row-number">#{issue.number}</span>
        <time dateTime={issue.createdAt} title={created.toLocaleString(language)}>{relativeTime(created, language)}</time>
        <LabelButtons labels={issue.labels} addLabel={addLabel} />
      </div>
    </div>
    {/* Dispatch controls take this place. */}
    <div className="issue-row-actions" />
  </li>;
}

function LabelButtons({ labels, addLabel }: { labels: IssueLabel[]; addLabel(name: string): void }) {
  const { t } = useLocalization();
  return labels.map(label => <button key={label.name} className="issue-label" style={{ '--label-color': `#${label.color}` } as CSSProperties}
    aria-label={t('filterByLabel', { label: label.name })} onClick={() => addLabel(label.name)}>{label.name}</button>);
}

/** A merge request row: no actions, since dispatch starts from issues. */
function MergeRequestRow({ request, addLabel }: { request: MergeRequestSummary; addLabel(name: string): void }) {
  const { t, language } = useLocalization();
  const created = new Date(request.createdAt);
  return <li className="issue-row" aria-label={`#${request.number} ${request.title}`}>
    <MergeRequestStateIcon request={request} />
    <div className="issue-row-main">
      <div className="issue-row-title">{request.title}</div>
      <div className="issue-row-meta">
        <span className="issue-row-number">#{request.number}</span>
        <time dateTime={request.createdAt} title={created.toLocaleString(language)}>{relativeTime(created, language)}</time>
        {/* GitHub names a deleted account ghost. */}
        <span className="issue-row-author">{request.author ?? t('deletedAuthor')}</span>
        {request.checks && <CheckIcon conclusion={request.checks} />}
        <LabelButtons labels={request.labels} addLabel={addLabel} />
      </div>
    </div>
  </li>;
}

// GitHub's own octicons: git-pull-request, git-pull-request-draft, git-merge and git-pull-request-closed.
const mergeRequestIcons = {
  open: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
  merged: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
  closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
};

function MergeRequestStateIcon({ request }: { request: MergeRequestSummary }) {
  const { t } = useLocalization();
  const [icon, name] = request.state === 'merged' ? ['merged', t('mergeRequestMerged')] as const
    : request.state === 'closed' ? ['closed', t('mergeRequestClosed')] as const
    : request.draft ? ['draft', t('mergeRequestDraft')] as const
    : ['open', t('mergeRequestOpen')] as const;
  return <svg className={`issue-state merge-request-state-${icon}`} role="img" aria-label={name} viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    <path d={mergeRequestIcons[icon]} />
  </svg>;
}

/** ✓ / ✗ / ● as GitHub marks a commit's checks. */
function CheckIcon({ conclusion }: { conclusion: CheckConclusion }) {
  const { t } = useLocalization();
  const [mark, name] = conclusion === 'passing' ? ['✓', t('checksPassed')] : conclusion === 'failing' ? ['✗', t('checksFailed')] : ['●', t('checksInProgress')];
  return <span className={`merge-request-checks merge-request-checks-${conclusion}`} role="img" aria-label={name} title={name}>{mark}</span>;
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

function IssueStateIcon({ issue }: { issue: IssueSummary }) {
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

function relativeTime(date: Date, language: Language) {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'minute');
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
