import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DesktopAPI } from '../../app/shared/api';
import type { NavigationPreferences, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { useProjectNavigation } from '../../app/renderer/ProjectNavigation';

// Render the public navigation interface with controllable IPC acknowledgements
// and snapshots. Pointer gestures still use the browser's real capture lifecycle.
export function createFixture(initial: Snapshot) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:999;background:white';
  document.body.append(host);
  const app = document.getElementById('root')!;
  const wasHidden = app.hidden; app.hidden = true;
  const root = createRoot(host);
  const requests: { preferences: NavigationPreferences; resolve(): void; reject(error: Error): void }[] = [];
  const notices: string[] = [];
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const api: Pick<DesktopAPI, 'saveNavigation' | 'subscribe'> = {
    saveNavigation: preferences => new Promise<void>((resolve, reject) => requests.push({ preferences, resolve, reject })),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let snapshot = structuredClone(initial);
  let update: (snapshot: Snapshot) => void;
  function App() {
    const [state, setState] = useState(snapshot);
    update = setState;
    const [page, setPage] = useState<'workbench' | 'setup' | 'settings'>('workbench');
    const navigation = useProjectNavigation({ snapshot: state, page,
      view: () => ({ selected: undefined, maximized: undefined }),
      openProject: () => setPage('workbench'), locatePanel: () => setPage('workbench'),
      createProject: () => setPage('setup'), toggleSettings: () => setPage(previous => previous === 'settings' ? 'workbench' : 'settings'),
      report: message => notices.push(message) }, api);
    return <div className="app"><header className="system-bar"><div className="system-brand">{navigation.toggle}</div></header>
      <div className="app-body">{navigation.sidebar}<main>{page}</main></div></div>;
  }
  flushSync(() => root.render(<App />));
  return {
    host, requests, notices,
    snapshot(change: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...change };
      flushSync(() => {
        listeners.forEach(listener => listener({ kind: 'snapshot', snapshot }));
        update(snapshot);
      });
    },
    dispose() { flushSync(() => root.unmount()); host.remove(); app.hidden = wasHidden; },
  };
}
