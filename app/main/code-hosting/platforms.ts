import type { PlatformId } from '../../shared/code-hosting';
import type { CodeHostingPlatform } from './platform';
import { github } from './github';

/** Adding a platform means adding its adapter here. */
export const platforms: Record<PlatformId, CodeHostingPlatform> = { github };
/** The platform offered to a project that has no binding yet. */
export const defaultPlatform: PlatformId = 'github';
