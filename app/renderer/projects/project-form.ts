import { useState, type ClipboardEvent } from 'react';
import { projectNameHasControls, type ProjectNameProblem } from '../../shared/project-name';
import { errorMessage } from '../../shared/caught-error';
import { useLatest } from '../common/effects/latest';
import { useTimeout } from '../common/effects/timeout';
import type { DirectoryCheck } from './directory-field';

export function useInspectedDirectory(input: string, reportFailure: (message: string) => void) {
  const [checked, setChecked] = useState<{ input: string; check: DirectoryCheck }>();
  if (checked && checked.input !== input) setChecked(undefined);
  const current = useLatest(input);
  useTimeout(
    () => {
      const inspected = input;
      void window.workbench
        .inspectDirectory(inspected)
        .then(check => {
          if (current.current === inspected) setChecked({ input: inspected, check });
        })
        .catch(error => {
          if (current.current !== inspected) return;
          setChecked({ input: inspected, check: { ok: false, problem: { kind: 'checkFailed' } } });
          reportFailure(errorMessage(error));
        });
    },
    { delay: input ? 180 : undefined, restartKey: input },
  );
  return checked?.input === input ? checked : undefined;
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
