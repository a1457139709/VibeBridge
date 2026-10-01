import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { model } from './model.prototype';

export function MockTerminal({ runId, selected, light }: { runId: string; selected: boolean; light: boolean }) {
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const run = state.runs[runId];
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const previous = useRef('');

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      allowProposedApi: false, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13, lineHeight: 1.55, letterSpacing: 0, cursorStyle: 'bar', cursorBlink: true,
      scrollback: 1000, convertEol: false, macOptionIsMeta: true,
      theme: { background: '#1b1d22', foreground: '#cbd0db', cursor: '#bbc7df', selectionBackground: '#5f718766', black: '#1b1d22', red: '#ce938d', green: '#94bba2', yellow: '#c8b791', blue: '#91a9d0', magenta: '#b3a0c6', cyan: '#94b9bf', white: '#d1d5df' },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    terminal.current = term; previous.current = '';
    const input = term.onData(data => {
      // This mock only simulates a line prompt. The real PTY must receive data unchanged.
      if (!data.startsWith('\x1b')) model.input(runId, data);
    });
    const resize = term.onResize(({ cols, rows }) => model.resizeRun(runId, cols, rows));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (host.current?.clientWidth && host.current.clientHeight) fit.fit(); });
    });
    observer.observe(host.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); input.dispose(); resize.dispose(); term.dispose(); terminal.current = null; };
  }, [runId]);

  useEffect(() => {
    const term = terminal.current; if (!term || !run) return;
    const output = run.output;
    if (output.startsWith(previous.current)) term.write(output.slice(previous.current.length));
    else { term.reset(); term.write(output); }
    previous.current = output;
  }, [run?.output, runId]);

  useEffect(() => {
    const term = terminal.current; if (!term) return;
    term.options.theme = light
      ? { background: '#fafaf8', foreground: '#373e48', cursor: '#64789b', selectionBackground: '#bac9dc66', black: '#323944', red: '#ae665d', green: '#5c826d', yellow: '#9b824f', blue: '#5b759c', magenta: '#8b72aa', cyan: '#507e89', white: '#727b87' }
      : { background: '#1b1d22', foreground: '#cbd0db', cursor: '#bbc7df', selectionBackground: '#5f718766', black: '#1b1d22', red: '#ce938d', green: '#94bba2', yellow: '#c8b791', blue: '#91a9d0', magenta: '#b3a0c6', cyan: '#94b9bf', white: '#d1d5df' };
  }, [light, runId]);

  useEffect(() => { if (selected) terminal.current?.focus(); }, [selected, runId]);
  return <div ref={host} className="terminal-host" data-run-id={runId} aria-label={`${run?.agent ?? 'Agent'} 模拟终端`} onClick={() => terminal.current?.focus()} />;
}
