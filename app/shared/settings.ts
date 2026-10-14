import type { Settings } from './model';
import { defaultShortcuts } from './shortcuts';

export const defaultSettings = (): Settings => ({ theme: 'system', defaultLayout: 'auto', shortcuts: defaultShortcuts(), agents: {
  codex: { command: 'codex', args: [] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
} });
