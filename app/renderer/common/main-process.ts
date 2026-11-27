import { useEffect, useEffectEvent } from 'react';
import type { Snapshot, WorkbenchEvent } from '../../shared/model';

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
