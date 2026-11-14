import type { ListFilter } from '../../app/shared/forge';
import { interactiveWorkbench } from './interactive-workbench';

/** The gh account the forge tests sign in as, with access to the bound repository. */
export const forgeAccount = { account: 'octo', repositories: ['octo/tools'] };
export const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
/** A fixed ISO 8601 date `n` days after 2026-01-01. */
export const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

/** A Workbench with one project bound to octo/tools on GitHub. */
export async function boundWorkbench(scope: string) {
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Bound');
  await f.workbench.editProject(project.id, { name: 'Bound', directory: f.directory, repository: { forge: 'github', path: 'octo/tools' } }, false);
  return { ...f, projectId: project.id };
}
