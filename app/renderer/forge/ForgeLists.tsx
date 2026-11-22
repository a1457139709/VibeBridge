import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { useLocalization } from '../common/Localization';
import { nestedMessage } from '../../shared/messages';
import type {
  ForgeFailure,
  IssueDetail,
  IssueSummary,
  ListFilter,
  RepositoryReference,
} from '../../shared/forge/forge';
import {
  forgeListTabs,
  type DetailItem,
  type FailedPage,
  type ForgeListTab,
  type ForgeLists as ListsData,
} from '../../shared/forge/sidebar-data';
import type { ProjectView } from '../../shared/model';
import { latestLocatableRecord } from '../../shared/dispatch';
import type { IssueShortcutAction } from '../../shared/settings/shortcuts';
import { errorMessage } from '../../shared/caught-error';
import { ForgeDetailPane } from './ForgeDetail';
import type { IssueDispatch } from './IssueDetail';
import { FilterBar } from './ForgeFilterBar';
import { DispatchButton, holdsDispatch, type DispatchHost } from '../dispatch/DispatchMenu';
import { LatestDispatchSkill } from '../dispatch/DispatchRecords';
import { IssueTree, issueRowOf, moveOrOpenRow, PullRequestRow, rowTitleIn } from './ForgeRows';
import { VirtualRows } from './VirtualRows';
import { useScrolledRows } from './scrolled-rows';
import { SidebarHead } from './SidebarHead';
import { useRowResting } from './row-resting';

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
interface OpenMenu {
  issue: number;
  place: 'row' | 'detail';
}
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

function useWindowForeground() {
  const [foreground, setForeground] = useState(() => document.hasFocus());
  useEffect(() => {
    const toFront = () => setForeground(true),
      behind = () => setForeground(false);
    window.addEventListener('focus', toFront);
    window.addEventListener('blur', behind);
    return () => {
      window.removeEventListener('focus', toFront);
      window.removeEventListener('blur', behind);
    };
  }, []);
  return foreground;
}

export interface ListsView {
  tab: ForgeListTab;
  filters: Record<ForgeListTab, ListFilter>;
}
export const openListsView: ListsView = {
  tab: 'issues',
  filters: { issues: openNoFilter, pullRequests: openNoFilter },
};

export interface DetailHost {
  startResize(event: ReactPointerEvent<HTMLDivElement>): void;
  onDetailOpenChange(open: boolean): void;
}

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  changeBinding(): void;
  detailHost: DetailHost;
  dispatchHost: Omit<DispatchHost, 'onDispatched'>;
  view: ListsView;
  rememberView(view: ListsView): void;
  ref?: Ref<ForgeListsActions>;
}

export interface ForgeListsActions {
  runIssueShortcut(action: IssueShortcutAction): boolean;
}

export function ForgeLists({ project, changeBinding, detailHost, dispatchHost, view, rememberView, ref }: Props) {
  const { t, text } = useLocalization();
  const [tab, setTab] = useState<ForgeListTab>(view.tab);
  const [filters, setFilters] = useState<Record<ForgeListTab, ListFilter>>(view.filters);
  useEffect(() => rememberView({ tab, filters }), [tab, filters]);
  const [detailFailure, setDetailFailure] = useState<FailedPage | null>(null);
  const lists = usePushedLists(project.id, () => setDetailFailure(null));
  const { loading } = lists;
  const declared = useRef<Record<ForgeListTab, ListFilter | null>>({ issues: null, pullRequests: null });
  const [opened, setOpened] = useState<DetailItem[]>([]);
  const detailItem = opened.at(-1);
  const detailOpen = detailItem !== undefined;
  useEffect(() => {
    detailHost.onDetailOpenChange(detailOpen);
    return () => detailHost.onDetailOpenChange(false);
  }, [detailOpen]);
  const openItem = (item: DetailItem) =>
    setOpened(stack =>
      stack.at(-1)?.kind === item.kind && stack.at(-1)?.number === item.number ? stack : [...stack, item],
    );
  const selected = (kind: DetailItem['kind']) => (detailItem?.kind === kind ? detailItem.number : undefined);

  const declare = (declaration: Promise<void>) =>
    void declaration.catch(error => dispatchHost.report(errorMessage(error)));
  const { scrollArea, scrollElement, holdScrollArea, rowsHost, keepReadingPosition, rowTitle } = useScrolledRows(
    project.id,
    lists,
    declare,
  );
  const refresh = () => {
    keepReadingPosition();
    declare(window.workbench.refreshForgeList(project.id));
  };
  const declaredDetail = useRef<DetailItem | null>(null);
  const showDetail = (item: DetailItem | null) => {
    declaredDetail.current = item;
    declare(window.workbench.showForgeDetail(project.id, item));
  };
  useEffect(() => {
    const item = detailItem ? { kind: detailItem.kind, number: detailItem.number } : null;
    const last = declaredDetail.current;
    if (item?.kind !== last?.kind || item?.number !== last?.number) showDetail(item);
  }, [detailItem?.kind, detailItem?.number]);
  useRowResting(scrollElement, item => declare(window.workbench.reportForgeRowResting(project.id, item)));
  const reportChanged = (item: DetailItem) => declare(window.workbench.reportForgeItemChanged(project.id, item));
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const dispatchButton = (issue: Pick<IssueSummary, 'number' | 'title'>, place: OpenMenu['place']) => {
    const isThisMenu = (menu?: OpenMenu) => menu?.issue === issue.number && menu.place === place;
    const host: DispatchHost = {
      ...dispatchHost,
      onDispatched(delivery) {
        if (delivery === 'fill') {
          setOpened([]);
          showDetail(null);
        }
        reportChanged({ kind: 'issue', number: issue.number });
      },
    };
    return (
      <DispatchButton
        project={project}
        issue={issue}
        host={host}
        open={isThisMenu(openMenu)}
        setOpen={open =>
          setOpenMenu(current => (open ? { issue: issue.number, place } : isThisMenu(current) ? undefined : current))
        }
      />
    );
  };
  const dispatchRecordsOf = (issueNumber: number) =>
    project.dispatches.filter(record => record.issueNumber === issueNumber);
  const issueAction = (issue: IssueSummary) => (
    <>
      {dispatchButton(issue, 'row')}
      <LatestDispatchSkill records={dispatchRecordsOf(issue.number)} host={dispatchHost} />
    </>
  );
  const issueDispatch = (issue: IssueDetail): IssueDispatch => ({
    button: dispatchButton(issue, 'detail'),
    records: dispatchRecordsOf(issue.number),
    host: dispatchHost,
  });
  useImperativeHandle(ref, () => ({
    runIssueShortcut(action) {
      const focus = document.activeElement;
      const focusedRow = issueRowOf(focus);
      const detailPane = focusedRow ? null : focus?.closest<HTMLElement>('.forge-detail');
      const issueNumber =
        focusedRow?.number ?? (detailPane && detailItem?.kind === 'issue' ? detailItem.number : undefined);
      if (issueNumber === undefined) return false;
      if (action === 'locateDispatchedPanel') {
        const location = latestLocatableRecord(dispatchRecordsOf(issueNumber))?.location;
        if (location) dispatchHost.locate(location.projectId, location.panelId);
        return true;
      }
      const scope = focusedRow?.row ?? detailPane;
      if (!scope || !holdsDispatch(scope)) return false;
      setOpenMenu({ issue: issueNumber, place: focusedRow ? 'row' : 'detail' });
      return true;
    },
  }));
  const awaitingFirstRows = useRef(true);
  const firstRowsLoaded = !!lists[tab].loaded?.items.length;
  useEffect(() => {
    if (!firstRowsLoaded || !awaitingFirstRows.current) return;
    awaitingFirstRows.current = false;
    if (document.activeElement === scrollArea.current?.closest('.forge-sidebar'))
      rowTitleIn(scrollArea.current)?.focus();
  }, [firstRowsLoaded]);
  const closeDetail = () => {
    const title = opened
      .toReversed()
      .map(item => rowTitle(item, tab))
      .find(Boolean);
    setOpened([]);
    (title ?? scrollArea.current)?.focus();
  };
  const openFromList = (item: DetailItem) => {
    const only = opened.length === 1 ? opened[0] : undefined;
    if (only?.kind === item.kind && only.number === item.number) closeDetail();
    else setOpened([item]);
  };
  const showForgeFailure = (failure: ForgeFailure) => setDetailFailure({ ok: false, failure, account: null });

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
  const foreground = useWindowForeground();
  useEffect(
    () => declare(window.workbench.reportForgeSidebarPresence({ visible: true, foreground, projectId: project.id })),
    [foreground],
  );
  useEffect(
    () => () =>
      declare(
        window.workbench.reportForgeSidebarPresence({
          visible: false,
          foreground: document.hasFocus(),
          projectId: project.id,
        }),
      ),
    [],
  );

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
        <p>{t(texts.loadFailed, { reason: nestedMessage(failed.failure.detail || failed.failure.kind) })}</p>
        {retry}
      </>,
    );

  const filter = filters[tab];
  const setFilter = (update: (filter: ListFilter) => ListFilter) =>
    setFilters(all => ({ ...all, [tab]: update(all[tab]) }));
  const addLabel = (name: string) =>
    setFilter(f => (f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] }));
  const pullRequests = lists.pullRequests.loaded;
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
      <div className="forge-scroll" ref={holdScrollArea} tabIndex={-1} onKeyDown={moveOrOpenRow}>
        {lists.issues.loaded && tab === 'issues' && (
          <IssueTree
            rowsHost={rowsHost}
            issues={lists.issues.loaded.items}
            listState={lists.issues.loaded.filter.state}
            capabilities={project.capabilities}
            forge={project.forge.name}
            selected={selected('issue')}
            open={number => openFromList({ kind: 'issue', number })}
            addLabel={addLabel}
            renderAction={issueAction}
          />
        )}
        {pullRequests && tab === 'pullRequests' && (
          <VirtualRows
            host={rowsHost}
            keys={pullRequests.items.map(item => item.number)}
            row={index => {
              const item = pullRequests.items[index];
              return (
                <li key={item.number}>
                  <PullRequestRow
                    pullRequest={item}
                    selected={item.number === selected('pullRequest')}
                    open={() => openFromList({ kind: 'pullRequest', number: item.number })}
                    addLabel={addLabel}
                  />
                </li>
              );
            }}
            className="forge-rows"
            aria-label={t(texts.name)}
          />
        )}
        {loaded && !loaded.items.length && <p className="forge-empty">{t(texts.noMatches)}</p>}
        {!loaded && <p className="forge-empty">{t(texts.loading)}</p>}
        {loaded?.nextCursor && (
          <button
            className="forge-more"
            disabled={loading}
            onClick={() => declare(window.workbench.loadMoreForgeList(project.id))}
          >
            {t('loadMore')}
          </button>
        )}
      </div>
      {detailItem && (
        <ForgeDetailPane
          project={project}
          item={detailItem}
          resize={detailHost.startResize}
          canBack={opened.length > 1}
          back={() => setOpened(stack => stack.slice(0, -1))}
          close={closeDetail}
          open={openItem}
          retry={() => showDetail(detailItem)}
          reportChanged={reportChanged}
          showForgeFailure={showForgeFailure}
          issueDispatch={issueDispatch}
        />
      )}
    </>
  );
}
