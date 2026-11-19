import type { ListFilter } from '../../app/shared/forge/forge';
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
