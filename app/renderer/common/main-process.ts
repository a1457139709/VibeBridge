import { useEffect, useEffectEvent } from 'react';
import type { Snapshot, WorkbenchEvent } from '../../shared/model';
import { useWindowEvent } from './window-events';

interface Connection {
  connected(initial: Snapshot): void;
  received(event: WorkbenchEvent): void;
  failed(error: unknown): void;
}

export function useMainProcessConnection(connection: Connection) {
  const connected = useEffectEvent(connection.connected);
  const received = useEffectEvent(connection.received);
  const failed = useEffectEvent(connection.failed);
  useEffect(() => {
    let open = true;
    let unsubscribe = () => {};
    void window.workbench
      .fetchSnapshot()
      .then(async initial => {
        if (!open) return;
        connected(initial);
        unsubscribe = window.workbench.subscribe(event => received(event));
        await window.workbench.reportRendererReady();
      })
      .catch(error => failed(error));
    return () => {
      open = false;
      unsubscribe();
    };
  }, []);
}

export function useMainProcessEvents(listener: (event: WorkbenchEvent) => void) {
  const received = useEffectEvent(listener);
  useEffect(() => window.workbench.subscribe(event => received(event)), []);
}

export function useForgeSidebarPresence(projectId: string, failed: (error: unknown) => void) {
  const report = (visible: boolean, foreground: boolean) =>
    void window.workbench.reportForgeSidebarPresence({ visible, foreground, projectId }).catch(failed);
  const reported = useEffectEvent(report);
  useEffect(() => {
    reported(true, document.hasFocus());
    return () => reported(false, document.hasFocus());
  }, []);
  useWindowEvent('focus', () => report(true, true));
  useWindowEvent('blur', () => report(true, false));
}

export function useShownForgeRows(projectId: string, numbers: number[], failed: (error: unknown) => void) {
  const shown = numbers.join();
  const declared = useEffectEvent(() => void window.workbench.showForgeRows(projectId, numbers).catch(failed));
  useEffect(() => declared(), [projectId, shown]);
}
