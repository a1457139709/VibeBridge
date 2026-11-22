import type { ForgeId } from '../../shared/forge/forge';
import { github } from './github';
import type { Forge } from './forge';

export const forges: Record<ForgeId, Forge> = { github };
export const defaultForge: ForgeId = 'github';
