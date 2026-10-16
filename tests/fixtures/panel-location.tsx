import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Project, Run, Snapshot } from '../../app/shared/model';
import { usePanelLocation, useWorkspacePanelLocation, type PanelLocation } from '../../app/renderer/panel-location';
import { configureTerminals, reconcileTerminals, mountTerminal } from '../../app/renderer/terminals';

// A small caller of the production hooks. Activation acknowledgements, snapshots
// and DOM attachment can advance independently; focus still uses real xterm DOM.
export function createFixture(initial: Snapshot) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:999;background:white';
  document.body.append(host);
  const app = document.getElementById('root')!;
  const wasHidden = app.hidden; app.hidden = true;
  const root = createRoot(host);
  const requests: { projectId: string; resolve(): void; reject(error: Error): void }[] = [];
  const notices: { message: string; kind?: string }[] = [];
  const report = (message: string, kind?: string) => { notices.push({ message, kind }); };
  configureTerminals(false, report);
  let snapshot = structuredClone(initial);
  snapshot.activeProjectId = snapshot.projects[0].id;
  let location: PanelLocation;
  let workspace: ReturnType<typeof useWorkspacePanelLocation>;
  let update: (change: Partial<Presentation>) => void;
  interface Presentation { snapshot: Snapshot; visible: boolean; attached: boolean; terminals: boolean; animations: boolean }
  function Terminal({ run }: { run?: Run }) {
    const element = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      if (run?.state === 'running') return mountTerminal(run.id, element.current!);
    }, [run?.id, run?.state]);
    return <div className="terminal-container" ref={element} style={{ height: 180 }} />;
  }
  function Workspace({ project, state }: { project: Project; state: Presentation }) {
    const canvas = useRef<HTMLDivElement>(null);
    workspace = useWorkspacePanelLocation(location, project, canvas, project.panels.map(panel => panel.id).reverse());
    useLayoutEffect(() => {
      if (!state.animations) Object.defineProperty(canvas.current!, 'animate', { value: undefined, configurable: true });
      else delete (canvas.current as Partial<HTMLElement>).animate;
    }, [state.animations]);
    return <div className="canvas" ref={canvas} style={{ display: 'flex', height: 220 }} data-project={project.id}>
      {project.panels.map(panel => <section key={panel.id} data-panel-id={panel.id}
        data-selected={workspace.selected === panel.id} data-maximized={workspace.maximized === panel.id}
        style={{ flex: 1, visibility: workspace.maximized && workspace.maximized !== panel.id ? 'hidden' : 'visible' }}
        onFocusCapture={() => workspace.focusChanged(panel.id)}>
        <button onClick={() => workspace.focus(panel.id)}>{panel.id}</button>
        {state.terminals && <Terminal run={state.snapshot.runs.find(run => run.panelId === panel.id)} />}
      </section>)}
    </div>;
  }
  function App() {
    const [state, setState] = useState<Presentation>({ snapshot, visible: true, attached: true, terminals: true, animations: false });
    update = change => setState(previous => ({ ...previous, ...change }));
    reconcileTerminals(state.snapshot.runs);
    location = usePanelLocation({ snapshot: state.snapshot, visible: state.visible,
      activateProject: projectId => new Promise<void>((resolve, reject) => requests.push({ projectId, resolve, reject })),
      showWorkbench: () => update({ visible: true }), report });
    const active = state.snapshot.projects.find(project => project.id === state.snapshot.activeProjectId);
    return <><button data-outside>Outside</button><div hidden={!state.visible} inert={!state.visible}>
      {state.attached && active && <Workspace key={active.id} project={active} state={state} />}
    </div></>;
  }
  flushSync(() => root.render(<App />));
  return {
    host, requests, notices,
    get location() { return location; },
    get workspace() { return workspace; },
    update(change: Partial<Presentation>) { flushSync(() => update(change)); },
    snapshot(change: Partial<Snapshot>) { snapshot = { ...snapshot, ...change }; flushSync(() => update({ snapshot })); },
    outside() { host.querySelector<HTMLButtonElement>('[data-outside]')!.focus(); },
    dispose() { flushSync(() => root.unmount()); reconcileTerminals([]); host.remove(); app.hidden = wasHidden; },
  };
}
