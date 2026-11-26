import { useState, type ClipboardEvent } from 'react';
import { useTimeout } from '../common/timer';
import { useRequestResult } from '../common/request-result';
import { projectNameHasControls, type ProjectNameProblem } from '../../shared/project-name';
import { errorMessage } from '../../shared/caught-error';
import type { DirectoryCheck } from './directory-field';

const inspectionDelay = 180;

export function useInspectedDirectory(input: string, reportFailure: (message: string) => void) {
  const [settledInput, setSettledInput] = useState<string>();
  useTimeout(() => setSettledInput(input), { delay: input ? inspectionDelay : undefined, restartKey: input });
  const check = useRequestResult<DirectoryCheck>(
    input && settledInput === input ? input : undefined,
    directory => window.workbench.inspectDirectory(directory),
    {
      recover: error => {
        reportFailure(errorMessage(error));
        return { ok: false, problem: { kind: 'checkFailed' } };
      },
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
