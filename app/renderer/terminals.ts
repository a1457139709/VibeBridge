import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Run, WorkbenchEvent } from '../shared/model';

interface Screen { terminal: Terminal; fit: FitAddon; element: HTMLDivElement; observer: ResizeObserver; opened: boolean; consumed: number }
const screens = new Map<string, Screen>();
let theme: ITheme;
let report: (message: string) => void;
export function configureTerminals(dark: boolean, onError: (message: string) => void) {
  report = onError;
  theme = dark ? { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#e6e6e6', cursorAccent: '#1e1e1e', selectionBackground: '#264f78', selectionInactiveBackground: '#3a3a3a' }
    : { background: '#ffffff', foreground: '#25302a', cursor: '#25302a', selectionBackground: '#94b5a280' };
}
function ensure(runId: string): Screen {
  const existing = screens.get(runId);
  if (existing) return existing;
  const terminal = new Terminal({ theme, minimumContrastRatio: 4.5, fontFamily: 'Menlo, Monaco, monospace', fontSize: 13, lineHeight: 1.16, scrollback: 5000, allowProposedApi: false });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const element = document.createElement('div'); element.className = 'terminal-screen';
  const observer = new ResizeObserver(() => {
    if (!element.clientWidth || !element.clientHeight) return;
    fit.fit();
  });
  const screen = { terminal, fit, element, observer, opened: false, consumed: 0 };
  screens.set(runId, screen);
  // Input sent just before the run ended is rejected after its exit disposed this screen; only a live screen reports.
  terminal.onData(data => { void window.workbench.sendInput(runId, data).catch(error => { if (screens.get(runId) === screen) report(error.message); }); });
  terminal.onResize(({ cols, rows }) => { void window.workbench.resizeRun(runId, cols, rows).catch(error => report(error.message)); });
  terminal.attachCustomKeyEventHandler(event => {
    if (event.metaKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) return false;
    if (event.metaKey && event.key.toLowerCase() === 'v') return false;
    return true;
  });
  return screen;
}
export function terminalEvent(event: WorkbenchEvent) {
  if (event.kind === 'started' && event.run.state === 'running') ensure(event.run.id);
  if (event.kind === 'output') {
    const screen = screens.get(event.runId);
    screen?.terminal.write(event.data, () => {
      if (screens.get(event.runId) !== screen) return;
      screen.consumed += event.data.length;
      if (screen.consumed >= 32 * 1024) {
        window.workbench.acknowledgeOutput(event.runId, screen.consumed);
        screen.consumed = 0;
      }
    });
  }
  if (event.kind === 'exit') dispose(event.runId);
}
export function reconcileTerminals(runs: Run[]) {
  for (const run of runs) if (run.state === 'running') ensure(run.id);
  for (const id of screens.keys()) if (!runs.some(run => run.id === id && run.state === 'running')) dispose(id);
}
function dispose(runId: string) {
  const screen = screens.get(runId);
  if (!screen) return;
  screen.observer.disconnect(); screen.terminal.dispose(); screen.element.remove(); screens.delete(runId);
}
export function mountTerminal(runId: string, container: HTMLElement) {
  const screen = ensure(runId);
  container.appendChild(screen.element);
  if (!screen.opened) { screen.terminal.open(screen.element); screen.opened = true; }
  screen.observer.observe(screen.element);
  if (screen.element.clientWidth && screen.element.clientHeight) screen.fit.fit();
  return () => { screen.observer.disconnect(); screen.element.remove(); };
}
export function focusTerminal(runId?: string) {
  const screen = runId ? screens.get(runId) : undefined;
  if (screen) screen.terminal.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
