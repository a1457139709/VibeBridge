import { envelope, type MessageReference } from './messages';

export type ProjectNameProblem = { kind: 'required' } | { kind: 'controls' };

export function projectNameHasControls(name: string): boolean {
  return /[\p{Cc}\u2028\u2029]/u.test(name);
}

export function projectNameProblem(name: string): ProjectNameProblem | null {
  if (projectNameHasControls(name)) return { kind: 'controls' };
  return name.trim() ? null : { kind: 'required' };
}

export function projectNameMessage(problem: ProjectNameProblem): MessageReference {
  switch (problem.kind) {
    case 'required':
      return { id: 'nameRequired' };
    case 'controls':
      return { id: 'nameControls' };
  }
}

export function rejectProjectName(name: string): void {
  const problem = projectNameProblem(name);
  if (problem) throw new Error(envelope(projectNameMessage(problem)));
}

export function projectNameFromDirectory(directory: string): string {
  const leaf = directory.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return leaf
    .replace(/\r\n|[\r\n\t\u0085\u2028\u2029]/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
}
