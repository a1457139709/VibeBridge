import type { ForgePresentation } from '../../../app/shared/forge';

export const githubForge: ForgePresentation = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login', capabilities: { subIssues: true, blocking: true } };
