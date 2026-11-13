import type { ForgeCapabilities, ForgePresentation } from '../../../app/shared/forge';

export const githubForge: ForgePresentation = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
export const githubCapabilities: ForgeCapabilities = { subIssues: true, blocking: true };
/** The forge fields of a ProjectView whose project uses GitHub. */
export const githubView = { forge: githubForge, capabilities: githubCapabilities };
