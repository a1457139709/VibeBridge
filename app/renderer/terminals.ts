import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Language, ProjectView, WorkbenchEvent } from '../shared/model';
import { localize } from '../shared/localization';

interface Screen { terminal: Terminal; fit: FitAddon; element: HTMLDivElement; observers: (ResizeObserver | IntersectionObserver)[]; inView: boolean; opened: boolean; consumed: number }
const screens = new Map<string, Screen>();
let theme: ITheme;
let report: (message: string) => void;
export function setTerminalLanguage(language: Language) {
  const { t } = localize(language);
  Terminal.strings.promptLabel = t('terminalInput');
  Terminal.strings.tooMuchOutput = t('terminalTooMuchOutput');
  for (const screen of screens.values()) screen.terminal.textarea?.setAttribute('aria-label', t('terminalInput'));
}
export function configureTerminals(dark: boolean, onError: (message: string) => void) {
  report = onError;
  theme = dark ? { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#e6e6e6', cursorAccent: '#1e1e1e', selectionBackground: '#505050', selectionInactiveBackground: '#3a3a3a' }
    : { background: '#ffffff', foreground: '#303030', cursor: '#303030', selectionBackground: '#b3b3b380' };
}
function ensure(runId: string): Screen {
  const existing = screens.get(runId);
  if (existing) return existing;
  const terminal = new Terminal({ theme, minimumContrastRatio: 4.5, fontFamily: 'Menlo, Monaco, monospace', fontSize: 13, lineHeight: 1.16, scrollback: 5000, allowProposedApi: false });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const element = document.createElement('div'); element.className = 'terminal-screen';
  // xterm pauses rendering while its screen is out of view and applies a new size only when it
  // renders again, yet sizes its scroll area at once. A scroll position clamped to that mismatch
  // reads as the user scrolling up, and the screen stops following output, so fitting waits for view.
  const fitInView = () => { if (screen.inView && element.clientWidth && element.clientHeight) fit.fit(); };
  // xterm's own observer resumes rendering in the same notification; fit on the frame after it.
  const view = new IntersectionObserver(entries => { screen.inView = entries[entries.length - 1].isIntersecting; if (screen.inView) requestAnimationFrame(fitInView); });
  const screen: Screen = { terminal, fit, element, observers: [new ResizeObserver(fitInView), view], inView: false, opened: false, consumed: 0 };
  screens.set(runId, screen);
  // Input sent just before the run ended is rejected after its exit disposed this screen; only a live screen reports.
  terminal.onData(data => { void window.workbench.sendInput(runId, data).catch(error => { if (screens.get(runId) === screen) report(error.message); }); });
  terminal.onResize(({ cols, rows }) => { void window.workbench.resizeRun(runId, cols, rows).catch(error => report(error.message)); });
  terminal.attachCustomKeyEventHandler(event => {
    // xterm sends Shift+Enter as Enter's carriage return; Agent CLIs read the CSI u form as a prompt newline.
    if (event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
      if (event.type === 'keydown') terminal.input('\x1b[13;2u');
      return false;
    }
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
export function reconcileTerminals(projects: ProjectView[]) {
  const running = new Set(projects.flatMap(project => project.panels.flatMap(({ run }) => run?.state === 'running' ? [run.id] : [])));
  for (const id of running) ensure(id);
  for (const id of screens.keys()) if (!running.has(id)) dispose(id);
}
function dispose(runId: string) {
  const screen = screens.get(runId);
  if (!screen) return;
  for (const observer of screen.observers) observer.disconnect();
  screen.terminal.dispose(); screen.element.remove(); screens.delete(runId);
}
export function mountTerminal(runId: string, container: HTMLElement) {
  const screen = ensure(runId);
  container.appendChild(screen.element);
  if (!screen.opened) { screen.terminal.open(screen.element); screen.opened = true; }
  for (const observer of screen.observers) observer.observe(screen.element);
  return () => { for (const observer of screen.observers) observer.disconnect(); screen.element.remove(); };
}
export function focusTerminal(runId?: string) {
  const screen = runId ? screens.get(runId) : undefined;
  if (!screen?.element.isConnected || !screen.element.checkVisibility() || !screen.element.clientWidth || !screen.element.clientHeight) return false;
  screen.terminal.focus();
  return document.activeElement === screen.terminal.textarea;
}
export function terminalHasFocus() {
  return [...screens.values()].some(screen => document.activeElement === screen.terminal.textarea);
}

// Measure a rendered row's font and spacing as one unit. Grid pixels and terminal
// cols/rows can update on different frames during fit, so their quotient is unsafe.
export function terminalCellSize(runId?: string) {
  const screen = runId ? screens.get(runId) : undefined;
  const row = screen?.element.querySelector<HTMLElement>('.xterm-rows > div');
  const rendered = row && getComputedStyle(row);
  const sample = document.createElement('span');
  sample.textContent = 'W'.repeat(32);
  sample.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;font-kerning:none';
  sample.style.fontFamily = rendered?.fontFamily || 'Menlo,Monaco,monospace';
  sample.style.fontSize = rendered?.fontSize || '13px';
  sample.style.fontWeight = rendered?.fontWeight || 'normal';
  sample.style.lineHeight = rendered?.lineHeight || '1.16';
  sample.style.letterSpacing = rendered?.letterSpacing || 'normal';
  document.body.append(sample);
  const measured = sample.getBoundingClientRect(); sample.remove();
  return { width: measured.width / 32, height: measured.height };
}
