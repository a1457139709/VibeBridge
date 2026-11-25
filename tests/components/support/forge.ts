import { fromAny } from '@total-typescript/shoehorn';
import type {
  ForgeCapabilities,
  ForgeId,
  ForgePresentation,
  RepositoryReference,
} from '../../../app/shared/forge/forge';

const testForgeId: ForgeId = fromAny('test-forge');
export const testForgeHost = 'forge.test';
export const testForgeUrl = `https://${testForgeHost}`;

export const testForge: ForgePresentation = {
  name: 'Test Forge',
  cli: 'tf',
  installUrl: `${testForgeUrl}/cli`,
  loginCommand: 'tf login',
};
export const testForgeCapabilities: ForgeCapabilities = {
  subIssues: true,
  blocking: true,
  requiredChecks: true,
  mergeQueue: true,
  mergeMethods: ['merge', 'squash', 'rebase'],
};
export const testForgeCapabilitiesWith = (overrides: Partial<ForgeCapabilities>): ForgeCapabilities => ({
  ...testForgeCapabilities,
  ...overrides,
});
export const testForgeView = { forge: testForge, capabilities: testForgeCapabilities, dispatches: [] };
export const testForgeRepository = (path: string, id = `id-${path}`): RepositoryReference => ({
  forge: testForgeId,
  host: testForgeHost,
  id,
  path,
});
