// Snapshot of the current UI icons; keep this prototype self-contained.
import type { CSSProperties, SVGProps } from 'react';
import type { AgentType } from './types.prototype';

export type IconName = 'plus' | 'close' | 'expand' | 'collapse' | 'more' | 'settings' | 'sidebar' | 'left' | 'right' | 'folder' | 'terminal' | 'sun' | 'moon' | 'monitor' | 'debug' | 'arrow' | 'check' | 'reset' | 'copy' | 'external' | 'power' | 'layers' | 'down' | 'keyboard' | 'search';
const paths: Record<IconName, string[]> = {
  plus: ['M12 5v14M5 12h14'], close: ['m6 6 12 12M18 6 6 18'],
  expand: ['M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'],
  collapse: ['M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  settings: ['m9 3-.5 2-2 1-2-.6-2 3.4 1.5 1.4v2.3L2.5 14l2 3.5 2-.6 2 1 .5 2.1h4l.5-2 2-1 2 .6 2-3.4-1.5-1.4v-2.3l1.5-1.5-2-3.5-2 .6-2-1L13 3Z', 'M15 11.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  sidebar: ['M4 4h16v16H4zM9 4v16M6 8h.01M6 12h.01'],
  left: ['m14 6-6 6 6 6'], right: ['m10 6 6 6-6 6'],
  folder: ['M3 7V5h6l2 3h10v12H3Z'], terminal: ['m5 6 5 5-5 5M13 17h6'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'],
  moon: ['M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z'],
  monitor: ['M3 4h18v13H3zM12 17v4M8 21h8'],
  debug: ['M9 4h6M10 4V2M14 4V2M8 8h8l2 3v6l-3 3H9l-3-3v-6ZM3 10l3 2M18 12l3-2M2 16h4M18 16h4M4 21l3-3M17 18l3 3M12 8v12'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'], check: ['m5 12 4 4 10-10'],
  reset: ['M3 11a9 9 0 1 1 2 7M3 4v7h7'],
  copy: ['M8 8h13v13H8ZM3 16V3h13'],
  external: ['M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7'],
  power: ['M12 2v10M6 5a9 9 0 1 0 12 0'],
  layers: ['m12 3 10 5-10 5L2 8ZM2 12l10 5 10-5M2 16l10 5 10-5'],
  down: ['m6 9 6 6 6-6'],
  keyboard: ['M2 5h20v14H2zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8'],
  search: ['M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0M14.5 14.5 21 21'],
};
export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name].map((d, i) => <path key={i} d={d} />)}</svg>;
}
export function AgentMark({ agent, size = 22, strokeScale = 1, style }: { agent: AgentType; size?: number; strokeScale?: number; style?: CSSProperties }) {
  if (agent === 'claude') return <svg width={size} height={size} viewBox="0 0 32 32" className="agent-mark claude-mark" aria-hidden="true" style={style}>{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M16 ${i % 2 ? 6 : 3}v8`} transform={`rotate(${i * 30} 16 16)`} stroke="currentColor" strokeWidth={2.2 * strokeScale} strokeLinecap="round" />)}</svg>;
  if (agent === 'pi') return <svg width={size} height={size} viewBox="0 0 32 32" className="agent-mark pi-mark" aria-hidden="true" style={style}><path d="M6 10h20M11 10v10c0 3-1 5-3 6M21 10v12c0 3 3 3 5 1" stroke="currentColor" strokeWidth={3.1 * strokeScale} fill="none" strokeLinecap="round" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 32 32" className="agent-mark codex-mark" aria-hidden="true" style={style}>{Array.from({ length: 6 }, (_, i) => <path key={i} d="M16 3c-5-1-9 4-7 8l7 4 6-4V6l-6-3Z" transform={`rotate(${i * 60} 16 16)`} fill="none" stroke="currentColor" strokeWidth={1.65 * strokeScale} strokeLinejoin="round" />)}</svg>;
}
export function BridgeMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 23V9m20 14V9M6 16c5 0 5-7 10-7s5 7 10 7M6 21h20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="6" cy="8" r="2" fill="currentColor" /><circle cx="26" cy="8" r="2" fill="currentColor" /></svg>;
}
