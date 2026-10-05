import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { model } from './model.prototype';

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  return {
    background: color('--panel'), foreground: color('--text'), cursor: color('--accent'), cursorAccent: color('--panel'),
    selectionBackground: color('--terminal-selection'),
    black: color('--terminal-black'), red: color('--error'), green: color('--terminal-green'), yellow: color('--terminal-yellow'),
    blue: color('--terminal-blue'), magenta: color('--terminal-magenta'), cyan: color('--terminal-cyan'), white: color('--text'),
    brightBlack: color('--muted'), brightRed: color('--error'), brightGreen: color('--terminal-green'), brightYellow: color('--terminal-yellow'),
    brightBlue: color('--terminal-blue'), brightMagenta: color('--terminal-magenta'), brightCyan: color('--terminal-cyan'), brightWhite: color('--text'),
    scrollbarSliderBackground: color('--selected-row'), scrollbarSliderHoverBackground: color('--selected-row'), scrollbarSliderActiveBackground: color('--selected-row'),
    overviewRulerBorder: color('--panel-border'),
  };
}

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
      scrollback: 1000, convertEol: false, macOptionIsMeta: true, minimumContrastRatio: 4.5,
      // xterm and FitAddon share this width; the scrollbar is hidden in CSS.
      overviewRuler: { width: 1, showTopBorder: false, showBottomBorder: false },
      theme: terminalTheme(),
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
    term.options.theme = terminalTheme();
  }, [light, runId]);

  useEffect(() => { if (selected) terminal.current?.focus(); }, [selected, runId]);
  return <div className="terminal-host" data-run-id={runId} aria-label={`${run?.agent ?? 'Agent'} 模拟终端`} onClick={() => terminal.current?.focus()}><div ref={host} className="terminal-content" /></div>;
}
