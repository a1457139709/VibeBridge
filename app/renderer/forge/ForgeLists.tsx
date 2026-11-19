import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { SyncIcon } from '@primer/octicons-react';
import { useLocalization } from '../common/Localization';
import { detail } from '../../shared/messages';
import type {
  ForgeFailure,
  IssueDetail,
  IssueSummary,
  ListFilter,
  RepositoryReference,
} from '../../shared/forge/forge';
import {
  forgeListTabs,
  type FailedPage,
  type ForgeListTab,
  type ForgeLists as ListsData,
} from '../../shared/forge/sidebar-data';
import type { ProjectView } from '../../shared/model';
import { latestLocatable } from '../../shared/dispatch';
import type { IssueShortcutAction } from '../../shared/settings/shortcuts';
import { ForgeDetailPane } from './ForgeDetail';
import type { IssueDispatch } from './IssueDetail';
import { FilterBar } from './ForgeFilterBar';
import { DispatchButton, holdsDispatch, type DispatchHost } from '../dispatch/DispatchMenu';
import { LatestDispatchSkill } from '../dispatch/DispatchRecords';
import type { DetailItem } from './ForgeDisplay';
import { IssueTree, issueRowOf, moveOrOpenRow, PullRequestRow, rowTitleIn, rowTitleOf } from './ForgeRows';

/** Each tab's own texts. */
const tabText = {
  issues: {
    name: 'issuesTab',
    search: 'searchIssues',
    loadFailed: 'issuesLoadFailed',
    noMatches: 'noMatchingIssues',
    loading: 'loadingIssues',
  },
  pullRequests: {
    name: 'pullRequestsTab',
    search: 'searchPullRequests',
    loadFailed: 'pullRequestsLoadFailed',
    noMatches: 'noMatchingPullRequests',
    loading: 'loadingPullRequests',
  },
} as const;
const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
const noRows = { loaded: null, failed: null };
const nothingLoaded: ListsData = { issues: noRows, pullRequests: noRows, loading: false };
/** Where an issue's open dispatch menu is: on its list row or in the detail. */
interface OpenMenu {
  issue: number;
  place: 'row' | 'detail';
}
/** The project's lists as the main process pushes them; nothing loaded until the first push. A push that settles a
 * request calls `settled`. */
function usePushedLists(projectId: string, settled: () => void) {
  const [lists, setLists] = useState<ListsData>(nothingLoaded);
  useEffect(
    () =>
      window.workbench.subscribe(event => {
        if (event.kind !== 'forgeLists' || event.projectId !== projectId) return;
        setLists(event.lists);
        if (!event.lists.loading) settled();
      }),
    [projectId],
  );
  return lists;
}

/** The sidebar's header: the repository, or that none is bound, with Change binding for a bound one's lists, and the persistent Refresh. */
export function SidebarHead({
  title,
  refresh,
  loading = false,
  changeBinding,
}: {
  title: string;
  refresh?(): void;
  loading?: boolean;
  changeBinding?(): void;
}) {
  const { t } = useLocalization();
  return (
    <header className="forge-sidebar-head">
      <span className="forge-sidebar-repository">{title}</span>
      {changeBinding && (
        <button className="forge-head-text" onClick={changeBinding}>
          {t('changeBinding')}
        </button>
      )}
      <button
        className={`forge-head-action forge-refresh ${loading ? 'spinning' : ''}`}
        aria-label={t('refresh')}
        data-hint={t('refresh')}
        aria-busy={loading}
        disabled={loading || !refresh}
        onClick={refresh}
      >
        <SyncIcon size={14} />
      </button>
    </header>
  );
}

/** The detail's resize edge, owned by the sidebar, and where it reports whether a detail is open. */
export interface DetailHost {
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  shown(open: boolean): void;
}

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  /** Turns the sidebar to its change-binding page. */
  changeBinding(): void;
  detailHost: DetailHost;
  /** Dispatching from an issue row or its detail; the lists add what happens once a dispatch went through. */
  dispatchHost: Omit<DispatchHost, 'dispatched'>;
  ref?: Ref<ForgeListsActions>;
}

/** The issue shortcuts, answered while focus is in the sidebar. */
export interface ForgeListsActions {
  /** Acts on the issue focus is on, its list row or the detail showing it: opens the dispatch menu of an open issue
   * where focus is, on its row or in the detail, or locates the panel of its latest dispatch a panel is on. Returns
   * false, leaving the key to go on, when there is no such issue. */
  handleIssueShortcut(action: IssueShortcutAction): boolean;
}

/** The bound repository's lists: a persistent Refresh, the Issues and Pull requests tabs, each with its own
 * search, filters, rows and failure, and the forge failure states. The main process holds the rows
 * (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md); this view declares the tab and filter it shows and
 * renders what is pushed. The owner mounts it per project and repository: opening the sidebar or returning to a project
 * starts from open with no filter, and refreshes. Only the current tab is fetched, each time it shows. There is no timed
 * refresh. Clicking a row opens its detail beside the list; links followed inside the detail stack up, so Back returns
 * to the item before. */
export function ForgeLists({ project, changeBinding, detailHost, dispatchHost, ref }: Props) {
  const { t, text } = useLocalization();
  const [tab, setTab] = useState<ForgeListTab>('issues');
  const [filters, setFilters] = useState<Record<ForgeListTab, ListFilter>>({
    issues: openNoFilter,
    pullRequests: openNoFilter,
  });
  /** A forge failure the detail met; it stands for the current tab's failure until a request settles the lists. */
  const [detailFailure, setDetailFailure] = useState<FailedPage | null>(null);
  const lists = usePushedLists(project.id, () => setDetailFailure(null));
  const { loading } = lists;
  /** Counts refreshes; the detail reloads on each. */
  const [generation, setGeneration] = useState(0);
  /** The filter each tab last declared, to tell typing in its search from another change. */
  const declared = useRef<Record<ForgeListTab, ListFilter | null>>({ issues: null, pullRequests: null });
  /** The items opened in the detail, the shown one last; empty when the detail is closed. */
  const [opened, setOpened] = useState<DetailItem[]>([]);
  const shown = opened.at(-1);
  const detailOpen = shown !== undefined;
  useEffect(() => {
    detailHost.shown(detailOpen);
    return () => detailHost.shown(false);
  }, [detailOpen]);
  const openItem = (item: DetailItem) =>
    setOpened(stack =>
      stack.at(-1)?.kind === item.kind && stack.at(-1)?.number === item.number ? stack : [...stack, item],
    );
  /** The number of the item of `kind` the detail shows, if any. */
  const selected = (kind: DetailItem['kind']) => (shown?.kind === kind ? shown.number : undefined);

  /** Sends a declaration to the main process; one that is refused is reported. */
  const declare = (declaration: Promise<void>) =>
    void declaration.catch((error: Error) => dispatchHost.report(error.message));
  /** The sidebar's one refresh: the current tab's first page and the open detail. */
  const refresh = () => {
    declare(window.workbench.refreshForgeList(project.id));
    setGeneration(count => count + 1);
  };
  // A dispatch refreshes the sidebar once; filling a panel also closes the detail, as focus moves into that panel.
  const listsDispatchHost: DispatchHost = {
    ...dispatchHost,
    dispatched(delivery) {
      if (delivery === 'fill') setOpened([]);
      refresh();
    },
  };
  /** The Dispatch whose menu is open, on an issue's list row or in the detail; one menu opens at a time. */
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  /** An issue's Dispatch on its list row or in the detail, holding whether its menu is open. */
  const dispatchButton = (issue: Pick<IssueSummary, 'number' | 'title'>, place: OpenMenu['place']) => {
    const isThisMenu = (menu?: OpenMenu) => menu?.issue === issue.number && menu.place === place;
    return (
      <DispatchButton
        project={project}
        issue={issue}
        host={listsDispatchHost}
        open={isThisMenu(openMenu)}
        setOpen={open =>
          setOpenMenu(current => (open ? { issue: issue.number, place } : isThisMenu(current) ? undefined : current))
        }
      />
    );
  };
  /** The rows: where focus returns from the detail, and where it rests when no row of the detail's items shows. */
  const scrollArea = useRef<HTMLDivElement>(null);
  const dispatchRecordsOf = (issueNumber: number) => project.dispatches.filter(record => record.issue === issueNumber);
  /** An open issue's dispatch action and the skill of its latest dispatch. */
  const issueAction = (issue: IssueSummary) => (
    <>
      {dispatchButton(issue, 'row')}
      <LatestDispatchSkill records={dispatchRecordsOf(issue.number)} host={dispatchHost} />
    </>
  );
  /** The detail's Dispatch and Dispatch Records of an issue. */
  const issueDispatch = (issue: IssueDetail): IssueDispatch => ({
    button: dispatchButton(issue, 'detail'),
    records: dispatchRecordsOf(issue.number),
    host: dispatchHost,
  });
  useImperativeHandle(ref, () => ({
    handleIssueShortcut(action) {
      const focus = document.activeElement;
      const focusedRow = issueRowOf(focus);
      const detailPane = focusedRow ? null : focus?.closest<HTMLElement>('.forge-detail');
      const issueNumber = focusedRow?.number ?? (detailPane && shown?.kind === 'issue' ? shown.number : undefined);
      if (issueNumber === undefined) return false;
      if (action === 'locateDispatchedPanel') {
        const location = latestLocatable(dispatchRecordsOf(issueNumber))?.location;
        if (location) dispatchHost.locate(location.projectId, location.panelId);
        return true;
      }
      // The menu opens where focus is: on the issue's list row, or in the detail on its own Dispatch, which needs no
      // list row showing. Only an open issue has Dispatch.
      const scope = focusedRow?.row ?? detailPane!;
      if (!holdsDispatch(scope)) return false;
      setOpenMenu({ issue: issueNumber, place: focusedRow ? 'row' : 'detail' });
      return true;
    },
  }));
  // Opening the sidebar puts focus in it before the list arrives; the first rows to arrive take it on to the first row.
  const awaitingFirstRows = useRef(true);
  const firstRowsLoaded = !!lists[tab].loaded?.items.length;
  useEffect(() => {
    if (!firstRowsLoaded || !awaitingFirstRows.current) return;
    awaitingFirstRows.current = false;
    if (document.activeElement === scrollArea.current?.closest('.forge-sidebar'))
      rowTitleIn(scrollArea.current)?.focus();
  }, [firstRowsLoaded]);
  /** Closes the detail and returns focus to the list row of the item it shows, or else of the one it opened from; with
   * no such row showing, to the list itself, so focus stays in the sidebar. */
  const closeDetail = () => {
    const title = opened
      .toReversed()
      .map(item => rowTitleOf(scrollArea.current, item))
      .find(Boolean);
    setOpened([]);
    (title ?? scrollArea.current)?.focus();
  };
  /** Opens a list row's item in the detail, with focus in it; the row of the one item the detail shows closes it. */
  const openFromList = (item: DetailItem) => {
    const only = opened.length === 1 ? opened[0] : undefined;
    if (only?.kind === item.kind && only.number === item.number) closeDetail();
    else setOpened([item]);
  };
  const forgeFailed = (failure: ForgeFailure) => setDetailFailure({ ok: false, failure, account: null });

  // The current tab is declared when it shows and whenever its filter changes; typing in the search settles first.
  useEffect(() => {
    const filter = filters[tab],
      last = declared.current[tab];
    const typing = last !== null && last.search !== filter.search;
    const timer = setTimeout(
      () => {
        declared.current[tab] = filter;
        declare(window.workbench.showForgeList(project.id, { tab, filter }));
      },
      typing ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [tab, filters[tab]]);
  useEffect(() => () => declare(window.workbench.hideForgeList(project.id)), []);

  const { forge } = project;
  const { loaded } = lists[tab];
  const failed = detailFailure ?? lists[tab].failed;
  const retry = (
    <button onClick={refresh} disabled={loading}>
      {t('retry')}
    </button>
  );
  const head = (
    <SidebarHead title={project.repository.path} refresh={refresh} loading={loading} changeBinding={changeBinding} />
  );
  const fill = (body: React.ReactNode) => (
    <>
      {head}
      <div className="forge-sidebar-state">{body}</div>
    </>
  );

  if (failed?.failure.kind === 'notInstalled')
    return fill(
      <>
        <p>{t('forgeCliMissing', { cli: forge.cli })}</p>
        <a href={forge.installUrl} target="_blank" rel="noreferrer">
          {t('installInstructions')}
        </a>
        {retry}
      </>,
    );
  if (failed?.failure.kind === 'loggedOut')
    return fill(
      <>
        <p>{t('forgeCliLoggedOut', { cli: forge.cli })}</p>
        <button onClick={() => void navigator.clipboard.writeText(forge.loginCommand)}>
          {t('copyCommand', { command: forge.loginCommand })}
        </button>
        {retry}
      </>,
    );
  if (failed?.failure.kind === 'inaccessible')
    return fill(
      <>
        <p>
          {failed.account === null
            ? t('repositoryInaccessibleNoAccount', { repository: project.repository.path, cli: forge.cli })
            : t('repositoryInaccessible', {
                repository: project.repository.path,
                cli: forge.cli,
                account: failed.account,
              })}
        </p>
        {retry}
        <button onClick={changeBinding}>{t('changeBinding')}</button>
      </>,
    );
  const texts = tabText[tab];
  if (failed && !loaded)
    return fill(
      <>
        <p>{t(texts.loadFailed, { reason: detail(failed.failure.detail || failed.failure.kind) })}</p>
        {retry}
      </>,
    );

  const filter = filters[tab];
  const setFilter = (update: (filter: ListFilter) => ListFilter) =>
    setFilters(all => ({ ...all, [tab]: update(all[tab]) }));
  const addLabel = (name: string) =>
    setFilter(f => (f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] }));
  return (
    <>
      {head}
      {failed && (
        <div className="forge-stale" title={text(failed.failure.detail)}>
          <span>{t('dataMayBeStale')}</span>
          {retry}
        </div>
      )}
      <nav className="forge-tabs" role="tablist" aria-label={t('sidebarTabs')}>
        {forgeListTabs.map(item => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'on' : ''}
            onClick={() => setTab(item)}
          >
            {t(tabText[item].name)}
          </button>
        ))}
      </nav>
      <FilterBar
        key={tab}
        searchLabel={t(texts.search)}
        filter={filter}
        setFilter={setFilter}
        labels={loaded?.labels ?? []}
        counts={loaded?.counts ?? null}
      />
      <div className="forge-scroll" ref={scrollArea} tabIndex={-1} onKeyDown={moveOrOpenRow}>
        {lists.issues.loaded && tab === 'issues' && (
          <IssueTree
            issues={lists.issues.loaded.items}
            state={lists.issues.loaded.filter.state}
            capabilities={project.capabilities}
            selected={selected('issue')}
            open={number => openFromList({ kind: 'issue', number })}
            addLabel={addLabel}
            action={issueAction}
          />
        )}
        {lists.pullRequests.loaded && tab === 'pullRequests' && (
          <ul className="forge-rows" aria-label={t(texts.name)}>
            {lists.pullRequests.loaded.items.map(item => (
              <li key={item.number}>
                <PullRequestRow
                  pullRequest={item}
                  selected={item.number === selected('pullRequest')}
                  open={() => openFromList({ kind: 'pullRequest', number: item.number })}
                  addLabel={addLabel}
                />
              </li>
            ))}
          </ul>
        )}
        {loaded && !loaded.items.length && <p className="forge-empty">{t(texts.noMatches)}</p>}
        {!loaded && <p className="forge-empty">{t(texts.loading)}</p>}
        {loaded?.cursor && (
          <button
            className="forge-more"
            disabled={loading}
            onClick={() => declare(window.workbench.loadMoreForgeList(project.id))}
          >
            {t('loadMore')}
          </button>
        )}
      </div>
      {shown && (
        <ForgeDetailPane
          project={project}
          item={shown}
          resize={detailHost.resize}
          canBack={opened.length > 1}
          back={() => setOpened(stack => stack.slice(0, -1))}
          close={closeDetail}
          open={openItem}
          generation={generation}
          refresh={refresh}
          forgeFailed={forgeFailed}
          issueDispatch={issueDispatch}
        />
      )}
    </>
  );
}
