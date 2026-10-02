import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AgentType } from './types.prototype';

export type Appearance = { fontSize: number; lineHeight: number; contrast: number; scrollbar: boolean };
export type RunState = { status: string; cols: number; rows: number; pid?: number; error?: string };
function theme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const color = (key: string) => css.getPropertyValue(key).trim();
  return {
    background: color('--panel'), foreground: color('--text'), cursor: color('--accent'), cursorAccent: color('--panel'), selectionBackground: color('--terminal-selection'),
    black: color('--terminal-black'), red: color('--error'), green: color('--terminal-green'), yellow: color('--terminal-yellow'),
    blue: color('--terminal-blue'), magenta: color('--terminal-magenta'), cyan: color('--terminal-cyan'), white: color('--text'),
    brightBlack: color('--muted'), brightRed: color('--error'), brightGreen: color('--terminal-green'), brightYellow: color('--terminal-yellow'),
    brightBlue: color('--terminal-blue'), brightMagenta: color('--terminal-magenta'), brightCyan: color('--terminal-cyan'), brightWhite: color('--text'),
  };
}
export function RealTerminal({ id, agent, light, appearance, selected, report }: {
  id: string; agent: AgentType; light: boolean; appearance: Appearance; selected: boolean;
  report: (state: Partial<RunState>) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const reportRef = useRef(report); reportRef.current = report;
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: appearance.fontSize, lineHeight: appearance.lineHeight, letterSpacing: 0,
      cursorStyle: 'bar', cursorBlink: true, scrollback: 10000, convertEol: false,
      macOptionIsMeta: true, minimumContrastRatio: appearance.contrast, theme: theme(),
      overviewRuler: { width: 1, showTopBorder: false, showBottomBorder: false },
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(element.current!);
    terminal.current = term; fitRef.current = fit;
    let disposed = false, started = false, frame = 0;
    const update = (state: Partial<RunState>) => { if (!disposed) reportRef.current(state); };
    const off = window.terminalPrototype.onEvent(event => {
      if (event.id !== id && event.id !== '*') return;
      if (event.type === 'output') term.write(event.data);
      if (event.type === 'exit') update({ status: `已退出 · ${event.exitCode}` });
      if (event.type === 'error') update({ status: '启动失败', error: event.message });
    });
    const input = term.onData(data => window.terminalPrototype.input(id, data));
    const binary = term.onBinary(data => window.terminalPrototype.input(id, data, true));
    const resize = term.onResize(({ cols, rows }) => {
      update({ cols, rows });
      if (started) window.terminalPrototype.resize(id, cols, rows);
    });
    // Electron's native copy/paste menu dispatches clipboard events to xterm.
    // An extra Cmd+V handler duplicates the same paste; leave one path only.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (element.current?.clientWidth && element.current.clientHeight) fit.fit(); });
    });
    observer.observe(element.current!);
    void document.fonts.ready.then(async () => {
      if (disposed) return;
      fit.fit();
      update({ cols: term.cols, rows: term.rows, status: '启动中' });
      try {
        const { pid } = await window.terminalPrototype.start({ id, agent, cols: term.cols, rows: term.rows });
        started = true;
        if (disposed) { await window.terminalPrototype.stop(id); return; }
        window.terminalPrototype.resize(id, term.cols, term.rows);
        update({ status: '运行中', pid }); term.focus();
      } catch (error) { update({ status: '启动失败', error: String(error) }); }
    });
    return () => {
      disposed = true; observer.disconnect(); cancelAnimationFrame(frame); off();
      input.dispose(); binary.dispose(); resize.dispose(); term.dispose(); terminal.current = null; fitRef.current = null;
      if (started) void window.terminalPrototype.stop(id).catch(() => {});
    };
    // An appearance change must never restart the real Agent.
  }, [id, agent]);
  useEffect(() => {
    const term = terminal.current; if (!term) return;
    term.options.theme = theme(); term.options.fontSize = appearance.fontSize;
    term.options.lineHeight = appearance.lineHeight; term.options.minimumContrastRatio = appearance.contrast;
    const frame = requestAnimationFrame(() => fitRef.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [appearance, light]);
  useEffect(() => { if (selected) terminal.current?.focus(); }, [selected]);
  return <div className={`terminal-host ${appearance.scrollbar ? '' : 'hide-scrollbar'}`} onClick={() => terminal.current?.focus()}>
    <div className="terminal-content" ref={element} aria-label={`${agent} 真实终端`} />
  </div>;
}
