import type { CodeHostingPlatformId } from '../../shared/code-hosting';
import { github } from './github';
import type { CodeHostingPlatform } from './platform';

/** One adapter per Code Hosting Platform. Adding a platform means adding its adapter here. */
export const codeHostingPlatforms: Record<CodeHostingPlatformId, CodeHostingPlatform> = { github };
/** The platform an unbound project lists repositories from. Choosing among several platforms is decided
 * when a second adapter joins (docs/adr/0006-code-hosting-platforms-sit-behind-an-interface.md). */
export const defaultPlatform: CodeHostingPlatformId = 'github';
