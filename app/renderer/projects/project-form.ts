import { useState, type ClipboardEvent } from 'react';
import { wait } from '../common/timer';
import { useRequestResult } from '../common/request-result';
import { projectNameHasControls, type ProjectNameProblem } from '../../shared/project-name';
import { errorMessage } from '../../shared/caught-error';
import type { DirectoryCheck } from './directory-field';

const inspectionDelay = 180;

export function useInspectedDirectory(input: string, reportFailure: (message: string) => void) {
  const check = useRequestResult<DirectoryCheck>(
    input || undefined,
    async (directory, signal) => {
      await wait(inspectionDelay, signal);
      return window.workbench.inspectDirectory(directory);
    },
    error => {
      reportFailure(errorMessage(error));
      return { ok: false, problem: { kind: 'checkFailed' } };
    },
  );
  return check && { input, check };
}

export function usePastedNameProblem() {
  const [problem, setProblem] = useState<ProjectNameProblem | null>(null);
  return {
    problem,
    clear: () => setProblem(null),
    checkPaste(event: ClipboardEvent<HTMLInputElement>) {
      if (projectNameHasControls(event.clipboardData.getData('text'))) {
        event.preventDefault();
        setProblem({ kind: 'controls' });
      } else setProblem(null);
    },
  };
}
