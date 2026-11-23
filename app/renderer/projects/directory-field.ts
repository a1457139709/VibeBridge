import type { MessageReference } from '../../shared/messages';
import type { DirectoryInspection, DirectoryProblem } from '../../shared/model';

export type DirectoryCheckProblem = DirectoryProblem | { kind: 'checkFailed' };
export type DirectoryCheck = Extract<DirectoryInspection, { ok: true }> | { ok: false; problem: DirectoryCheckProblem };
export type DirectoryFieldProblem = DirectoryCheckProblem | { kind: 'required' };

export interface DirectoryFieldInput {
  input: string;
  touched: boolean;
  checked?: { input: string; check: DirectoryCheck };
  editing?: { projectId: string; directory: string };
}

export interface DirectoryField {
  directory: string | null;
  checking: boolean;
  problem: DirectoryFieldProblem | null;
  changed: boolean;
  canSave: boolean;
}

const blocked = (problem: DirectoryFieldProblem | null, checking = false): DirectoryField => ({
  directory: null,
  checking,
  problem,
  changed: false,
  canSave: false,
});

export function presentDirectoryField({ input, touched, checked, editing }: DirectoryFieldInput): DirectoryField {
  const usable = (directory: string): DirectoryField => ({
    directory,
    checking: false,
    problem: null,
    changed: editing !== undefined && directory !== editing.directory,
    canSave: true,
  });
  if (!input) return blocked(touched ? { kind: 'required' } : null);
  const check = checked?.input === input ? checked.check : undefined;
  if (!check) return editing && input === editing.directory ? usable(editing.directory) : blocked(null, true);
  if (check.ok) return usable(check.directory);
  const { problem } = check;
  if (editing && problem.kind === 'duplicate' && problem.projectId === editing.projectId)
    return usable(editing.directory);
  return blocked(problem);
}

export function directoryProblemMessage(problem: DirectoryFieldProblem, form: 'create' | 'edit'): MessageReference {
  switch (problem.kind) {
    case 'required':
      return { id: 'directoryRequired' };
    case 'missing':
    case 'notDirectory':
    case 'checkFailed':
      return { id: 'directoryInvalid' };
    case 'duplicate':
      return { id: form === 'create' ? 'duplicateCreate' : 'duplicateEdit', values: { name: problem.projectName } };
  }
}
