import type { Run } from './model';

// Observation release: keep the CLI's raw title, including status symbols and directory text.
export const sessionTitle = (run?: Pick<Run, 'rawTitle'>): string => run?.rawTitle || 'Untitled task';
