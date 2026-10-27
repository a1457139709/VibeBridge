import type { AgentType } from '../shared/model';

/** The session title in an Agent's terminal title, or undefined while the session has none. */
export function sessionTitle(agent: AgentType, rawTitle: string): string | undefined {
  if (agent === 'claude') {
    const title = rawTitle.trim().replace(/^[✳◐◑\s]+|[✳◐◑\s]+$/gu, '');
    return !title || title === 'Claude Code' ? undefined : title;
  }
  if (agent === 'codex') {
    // Codex 0.162.1 cycles through all ten Unicode title-spinner frames.
    const title = rawTitle.trim().replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/gu, '');
    // Keep empty fields and overlapping separators visible as unknown formats.
    const parts = ` ${title} `.split(/(?<= )\|(?= )/u);
    if (parts.length === 1 && !title.includes('|')) return undefined;
    if (parts.length === 2 && parts.every(part => part.trim())) return parts[0].trim();
    return title;
  }
  const title = rawTitle.trim();
  if (agent === 'pi' && title.startsWith('π - ')) {
    const parts = ` ${title.slice(4)} `.split(/(?<= )-(?= )/u);
    if (parts.every(part => part.trim())) {
      if (parts.length === 1) return undefined;
      if (parts.length === 2) return parts[0].trim();
    }
  }
  return title || undefined;
}
