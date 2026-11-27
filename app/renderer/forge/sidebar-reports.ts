import { useEffect, useEffectEvent, useState } from 'react';
import { useWindowEvent } from '../common/window-events';

export function useForgeSidebarPresence(projectId: string, failed: (error: unknown) => void) {
  const reportFailure = useEffectEvent(failed);
  const report = (visible: boolean, foreground: boolean) =>
    void window.workbench.reportForgeSidebarPresence({ visible, foreground, projectId }).catch(failed);
  useEffect(() => {
    const reportVisible = (visible: boolean) =>
      void window.workbench
        .reportForgeSidebarPresence({ visible, foreground: document.hasFocus(), projectId })
        .catch(reportFailure);
    reportVisible(true);
    return () => reportVisible(false);
  }, [projectId]);
  useWindowEvent('focus', () => report(true, true));
  useWindowEvent('blur', () => report(true, false));
}

const sameNumbers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((number, index) => number === b[index]);

export function useShownForgeRows(projectId: string, numbers: number[], failed: (error: unknown) => void) {
  const reportFailure = useEffectEvent(failed);
  const [shown, setShown] = useState(numbers);
  if (!sameNumbers(shown, numbers)) setShown(numbers);
  useEffect(() => {
    void window.workbench.showForgeRows(projectId, shown).catch(reportFailure);
  }, [projectId, shown]);
}

export function useRepositoryChoicesShown(projectId: string, failed: (error: unknown) => void) {
  const reportFailure = useEffectEvent(failed);
  useEffect(() => {
    void window.workbench.showRepositoryChoices(projectId).catch(reportFailure);
  }, [projectId]);
}
