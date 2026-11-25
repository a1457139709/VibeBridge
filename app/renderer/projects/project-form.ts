import { useEffect, useState, type ClipboardEvent } from 'react';
import { projectNameHasControls, type ProjectNameProblem } from '../../shared/project-name';
import { errorMessage } from '../../shared/caught-error';
import type { DirectoryCheck } from './directory-field';

export function useInspectedDirectory(input: string, reportFailure: (message: string) => void) {
  const [checked, setChecked] = useState<{ input: string; check: DirectoryCheck }>();
  useEffect(() => {
    setChecked(undefined);
    if (!input) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.workbench
        .inspectDirectory(input)
        .then(check => {
          if (live) setChecked({ input, check });
        })
        .catch(error => {
          if (!live) return;
          setChecked({ input, check: { ok: false, problem: { kind: 'checkFailed' } } });
          reportFailure(errorMessage(error));
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input]);
  return checked;
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
