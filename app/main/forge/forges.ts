import type { ForgeId } from '../../shared/forge';
import { github } from './github';
import type { Forge } from './forge';

/** One adapter per Forge. Adding a forge means adding its adapter here. */
export const forges: Record<ForgeId, Forge> = { github };
/** The forge an unbound project lists repositories from. Choosing among several forges is decided
 * when a second adapter joins (docs/adr/0006-forges-sit-behind-an-interface.md). */
export const defaultForge: ForgeId = 'github';
