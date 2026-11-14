import type { ForgeCapabilities, ForgePresentation } from '../../../app/shared/forge';

export const githubForge: ForgePresentation = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
export const githubCapabilities: ForgeCapabilities = { subIssues: true, blocking: true, requiredChecks: true, mergeQueue: true, mergeMethods: ['merge', 'squash', 'rebase'] };
/** The forge fields of a ProjectView whose project uses GitHub, with no Dispatch Records. */
export const githubView = { forge: githubForge, capabilities: githubCapabilities, dispatches: [] };
