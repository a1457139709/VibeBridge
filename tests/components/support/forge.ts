import type { ForgeCapabilities, ForgePresentation, RepositoryReference } from '../../../app/shared/forge/forge';

export const githubForge: ForgePresentation = {
  name: 'GitHub',
  cli: 'gh',
  installUrl: 'https://cli.github.com',
  loginCommand: 'gh auth login',
};
export const githubCapabilities: ForgeCapabilities = {
  subIssues: true,
  blocking: true,
  requiredChecks: true,
  mergeQueue: true,
  mergeMethods: ['merge', 'squash', 'rebase'],
};
export const githubView = { forge: githubForge, capabilities: githubCapabilities, dispatches: [] };
export const githubRepository = (path: string, id = `id-${path}`): RepositoryReference => ({
  forge: 'github',
  host: 'github.com',
  id,
  path,
});
