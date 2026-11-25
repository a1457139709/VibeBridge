import type { MessageReference } from './messages';
import type { DirectoryProblem } from './model';

export type DirectoryCheckProblem = DirectoryProblem | { kind: 'checkFailed' };
export type DirectoryFieldProblem = DirectoryCheckProblem | { kind: 'required' };

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
