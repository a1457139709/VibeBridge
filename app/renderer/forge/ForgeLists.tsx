import { useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { useLocalization } from '../common/Localization';
import { useForgeSidebarPresence, useMainProcessEvents } from '../common/main-process';
import { Timeout } from '../common/timer';
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
  sameItem,
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
import { StaleNotice } from './StaleNotice';
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
interface DeclaredList {
  request: string | null;
  searches: Record<ForgeListTab, string | null>;
}
const nothingDeclared: DeclaredList = { request: null, searches: { issues: null, pullRequests: null } };
const typingDelay = 300;

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
  const [detailFailure, setDetailFailure] = useState<FailedPage | null>(null);
  const [lists, setLists] = useState<ListsData>(nothingLoaded);
  const { loading } = lists;
  const [opened, setOpened] = useState<DetailItem[]>([]);
  const detailItem = opened.at(-1);
  const selected = (kind: DetailItem['kind']) => (detailItem?.kind === kind ? detailItem.number : undefined);

  const reportFailure = (error: unknown) => dispatchHost.report(errorMessage(error));
  const declare = (declaration: Promise<void>) => void declaration.catch(reportFailure);
  const {
    scrollArea,
    holdScrollArea,
    readScrollArea,
    rowsHost,
    keepReadingPosition,
    restoreReadingPosition,
    rowTitle,
  } = useScrolledRows(project.id, reportFailure);
  const awaitingFirstRows = useRef(true);
  const focusFirstRow = (shown: ListsData, shownTab: ForgeListTab) => {
    if (!awaitingFirstRows.current || !shown[shownTab].loaded?.items.length) return;
    awaitingFirstRows.current = false;
    if (document.activeElement === scrollArea?.closest('.forge-sidebar')) rowTitleIn(scrollArea)?.focus();
  };
  useMainProcessEvents(event => {
    if (event.kind !== 'forgeLists' || event.projectId !== project.id) return;
    flushSync(() => {
      setLists(event.lists);
      if (!event.lists.loading) setDetailFailure(null);
    });
    focusFirstRow(event.lists, tab);
    if (!event.lists.loading) restoreReadingPosition();
  });
  const refresh = () => {
    keepReadingPosition();
    declare(window.workbench.refreshForgeList(project.id));
  };
  const declaredDetail = useRef<DetailItem | null>(null);
  const showDetail = (item: DetailItem | null) => {
    declaredDetail.current = item;
    declare(window.workbench.showForgeDetail(project.id, item));
  };
  const changeOpened = (stack: DetailItem[]) => {
    setOpened(stack);
    const top = stack.at(-1) ?? null;
    if (!sameItem(top, declaredDetail.current)) showDetail(top && { kind: top.kind, number: top.number });
    detailHost.onDetailOpenChange(top !== null);
  };
  const openItem = (item: DetailItem) => changeOpened(sameItem(detailItem ?? null, item) ? opened : [...opened, item]);
  useRowResting(scrollArea, item => declare(window.workbench.reportForgeRowResting(project.id, item)));
  const reportChanged = (item: DetailItem) => declare(window.workbench.reportForgeItemChanged(project.id, item));
  const [openMenu, setOpenMenu] = useState<OpenMenu>();
  const dispatchButton = (issue: Pick<IssueSummary, 'number' | 'title'>, place: OpenMenu['place']) => {
    const isThisMenu = (menu?: OpenMenu) => menu?.issue === issue.number && menu.place === place;
    const host: DispatchHost = {
      ...dispatchHost,
      onDispatched(delivery) {
        if (delivery === 'fill') changeOpened([]);
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
  const closeDetail = () => {
    const title = opened
      .toReversed()
      .map(item => rowTitle(item, tab))
      .find(Boolean);
    changeOpened([]);
    (title ?? scrollArea)?.focus();
  };
  const openFromList = (item: DetailItem) => {
    const only = opened.length === 1 ? opened[0] : undefined;
    if (only?.kind === item.kind && only.number === item.number) closeDetail();
    else changeOpened([item]);
  };
  const showForgeFailure = (failure: ForgeFailure) => setDetailFailure({ ok: false, failure, account: null });
  const chooseTab = (chosen: ForgeListTab) => {
    setTab(chosen);
    rememberView({ tab: chosen, filters });
    focusFirstRow(lists, chosen);
  };

  const [declaredList, setDeclaredList] = useState<DeclaredList>(nothingDeclared);
  const listRequest = JSON.stringify({ tab, filter: filters[tab] });
  const lastSearch = declaredList.searches[tab];
  const typing = lastSearch !== null && lastSearch !== filters[tab].search;
  const showList = () => {
    const filter = filters[tab];
    setDeclaredList(last => ({ request: listRequest, searches: { ...last.searches, [tab]: filter.search } }));
    declare(window.workbench.showForgeList(project.id, { tab, filter }));
  };
  useForgeSidebarPresence(project.id, reportFailure);

  const { forge } = project;
  const { loaded } = lists[tab];
  const failed = detailFailure ?? lists[tab].failed;
  const retry = (
    <button onClick={refresh} disabled={loading}>
      {t('retry')}
    </button>
  );
  const head = (
    <>
      {declaredList.request !== listRequest && (
        <Timeout key={listRequest} delay={typing ? typingDelay : 0} onTimeout={showList} />
      )}
      <SidebarHead title={project.repository.path} refresh={refresh} loading={loading} changeBinding={changeBinding} />
    </>
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
        <p role="alert">{t('forgeCliMissing', { cli: forge.cli })}</p>
        <a href={forge.installUrl} target="_blank" rel="noreferrer">
          {t('installInstructions')}
        </a>
        {retry}
      </>,
    );
  if (failed?.failure.kind === 'loggedOut')
    return fill(
      <>
        <p role="alert">{t('forgeCliLoggedOut', { cli: forge.cli })}</p>
        <button onClick={() => void navigator.clipboard.writeText(forge.loginCommand)}>
          {t('copyCommand', { command: forge.loginCommand })}
        </button>
        {retry}
      </>,
    );
  if (failed?.failure.kind === 'inaccessible')
    return fill(
      <>
        <p role="alert">
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
        <p role="alert">
          {t(texts.loadFailed, { reason: nestedMessage(failed.failure.detail || failed.failure.kind) })}
        </p>
        {retry}
      </>,
    );

  const filter = filters[tab];
  const setFilter = (update: (filter: ListFilter) => ListFilter) => {
    const changed = { ...filters, [tab]: update(filters[tab]) };
    setFilters(changed);
    rememberView({ tab, filters: changed });
  };
  const addLabel = (name: string) =>
    setFilter(f => (f.labels.includes(name) ? f : { ...f, labels: [...f.labels, name] }));
  const pullRequests = lists.pullRequests.loaded;
  return (
    <>
      {head}
      {failed && <StaleNotice detail={text(failed.failure.detail)} retry={refresh} disabled={loading} />}
      <nav className="forge-tabs" role="tablist" aria-label={t('sidebarTabs')}>
        {forgeListTabs.map(item => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'on' : ''}
            onClick={() => chooseTab(item)}
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
      <div
        className="forge-scroll"
        ref={holdScrollArea}
        tabIndex={-1}
        onKeyDown={moveOrOpenRow}
        onScroll={readScrollArea}
      >
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
            row={(index, measure) => {
              const item = pullRequests.items[index];
              return (
                <li key={item.number} ref={measure}>
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
        {loaded && !loaded.items.length && (
          <p className="forge-empty" role="status">
            {t(texts.noMatches)}
          </p>
        )}
        {!loaded && (
          <p className="forge-empty" role="status">
            {t(texts.loading)}
          </p>
        )}
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
          back={() => changeOpened(opened.slice(0, -1))}
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
