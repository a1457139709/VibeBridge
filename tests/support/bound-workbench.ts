import type { IssueDetailResult, ListFilter, PullRequestDetailResult } from '../../app/shared/forge/forge';
import type { DetailItem, DetailResult, ForgeListTab, ForgeLists } from '../../app/shared/forge/sidebar-data';
import type { Workbench } from '../../app/main/workbench';
import { interactiveWorkbench } from './interactive-workbench';

/** The gh account the forge tests sign in as, with access to the bound repository. */
export const forgeAccount = { account: 'octo', repositories: ['octo/tools'] };
export const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
/** A fixed ISO 8601 date `n` days after 2026-01-01. */
export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

/** Binds the project to the repository the forge lists at `path`, as picking it in the Forge sidebar does. */
export async function bindListed(workbench: Workbench, projectId: string, path: string) {
  const project = workbench.snapshot().projects.find(item => item.id === projectId)!;
  const choices = await workbench.repositoryChoices(projectId, project.directory);
  const repository = choices.ok && choices.repositories.find(item => item.path === path);
  if (!repository) throw new Error(`The forge does not list ${path}`);
  return workbench.bindRepository(projectId, repository);
}

/** A Workbench with one project bound to octo/tools on GitHub. */
export async function boundWorkbench(scope: string) {
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Bound');
  await bindListed(f.workbench, project.id, 'octo/tools');
  return { ...f, projectId: project.id };
}

/** The project's lists as the main process pushes them once `declare`, a declaration on the Forge sidebar, settles. */
export async function shownLists(workbench: Workbench, projectId: string, declare: () => Promise<void>) {
  let shown: ForgeLists | undefined;
  const stop = workbench.subscribe(event => {
    if (event.kind === 'forgeLists' && event.projectId === projectId) shown = event.lists;
  });
  try {
    await declare();
  } finally {
    stop();
  }
  if (!shown || shown.loading) throw new Error('The lists did not settle');
  return shown;
}

/** The project's lists once the sidebar shows `tab` with `filter`. */
export const showList = (
  workbench: Workbench,
  projectId: string,
  tab: ForgeListTab = 'issues',
  filter: ListFilter = openNoFilter,
) => shownLists(workbench, projectId, () => workbench.forgeSidebar.showList(projectId, { tab, filter }));

/** The project's lists once the sidebar's Refresh reloads the shown tab's first page. */
export const refreshList = (workbench: Workbench, projectId: string) =>
  shownLists(workbench, projectId, () => workbench.forgeSidebar.refresh(projectId));

/** What the detail shows of `item` as the main process pushes it once `declare`, a declaration on the Forge sidebar,
 * settles. */
export async function shownDetail(
  workbench: Workbench,
  projectId: string,
  item: DetailItem,
  declare: () => Promise<void> = () => workbench.forgeSidebar.showDetail(projectId, item),
): Promise<DetailResult> {
  let shown: DetailResult | null = null;
  const stop = workbench.subscribe(event => {
    if (event.kind === 'forgeDetail' && event.projectId === projectId)
      shown =
        event.detail.item.kind === item.kind && event.detail.item.number === item.number ? event.detail.result : null;
  });
  try {
    await declare();
  } finally {
    stop();
  }
  if (!shown) throw new Error('The detail did not settle');
  return shown;
}
/** The issue the detail shows once the sidebar opens it. */
export const issueDetail = (workbench: Workbench, projectId: string, number: number) =>
  shownDetail(workbench, projectId, { kind: 'issue', number }) as Promise<IssueDetailResult>;
/** The pull request the detail shows once the sidebar opens it. */
export const pullRequestDetail = (workbench: Workbench, projectId: string, number: number) =>
  shownDetail(workbench, projectId, { kind: 'pullRequest', number }) as Promise<PullRequestDetailResult>;
