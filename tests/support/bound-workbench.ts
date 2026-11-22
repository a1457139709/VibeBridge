import assert from 'node:assert/strict';
import type { IssueDetailResult, ListFilter, PullRequestDetailResult } from '../../app/shared/forge/forge';
import type { DetailItem, DetailResult, ForgeListTab, ForgeLists } from '../../app/shared/forge/sidebar-data';
import type { Workbench } from '../../app/main/workbench';
import { interactiveWorkbench } from './interactive-workbench';

export const forgeAccount = { account: 'octo', repositories: ['octo/tools'] };
export const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

export async function bindListed(workbench: Workbench, projectId: string, path: string) {
  const project = workbench.snapshot().projects.find(item => item.id === projectId);
  assert.ok(project);
  const choices = await workbench.fetchRepositoryChoices(projectId, project.directory);
  const repository = choices.ok && choices.repositories.find(item => item.path === path);
  if (!repository) throw new Error(`The forge does not list ${path}`);
  return workbench.bindRepository(projectId, repository);
}

export async function boundWorkbench(scope: string) {
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Bound');
  await bindListed(f.workbench, project.id, 'octo/tools');
  return { ...f, projectId: project.id };
}

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

export const showList = (
  workbench: Workbench,
  projectId: string,
  tab: ForgeListTab = 'issues',
  filter: ListFilter = openNoFilter,
) => shownLists(workbench, projectId, () => workbench.forgeSidebar.showList(projectId, { tab, filter }));

export const refreshList = (workbench: Workbench, projectId: string) =>
  shownLists(workbench, projectId, () => workbench.forgeSidebar.refresh(projectId));

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
export async function issueDetail(workbench: Workbench, projectId: string, number: number): Promise<IssueDetailResult> {
  const result = await shownDetail(workbench, projectId, { kind: 'issue', number });
  if ('pullRequest' in result) throw new Error(`The detail shows pull request ${number}`);
  return result;
}
export async function pullRequestDetail(
  workbench: Workbench,
  projectId: string,
  number: number,
): Promise<PullRequestDetailResult> {
  const result = await shownDetail(workbench, projectId, { kind: 'pullRequest', number });
  if ('issue' in result) throw new Error(`The detail shows issue ${number}`);
  return result;
}
