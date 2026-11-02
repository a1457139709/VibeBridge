// PROTOTYPE — throwaway, part of prototype-ephemeral-panels.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// The floating yellow bar that switches prototype variants.
import React, { useState } from 'react';
import { docks, views, columnModes, chromes, type Chrome, type ColumnMode, type Dock, type View } from './prototype-ephemeral-panels-options';

export const cycle = <T extends string>(list: readonly { key: T }[], current: T, step: number) => list[(list.findIndex(i => i.key === current) + step + list.length) % list.length].key;
type Set<T> = (update: (value: T) => T) => void;

export function Switcher({ chrome, setChrome, dock, setDock, view, setView, columnMode, setColumnMode, theme, setTheme, running, setRunning, addEphemeral, canAdd, state }: {
  chrome: Chrome; setChrome: Set<Chrome>; dock: Dock; setDock: Set<Dock>; view: View; setView: Set<View>; columnMode: ColumnMode; setColumnMode(mode: ColumnMode): void;
  theme: string; setTheme: Set<string>; running: boolean; setRunning: Set<boolean>; addEphemeral(): void; canAdd: boolean; state: string;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <button className="proto-bar proto-bar-mini" onClick={() => setHidden(false)}>PROTOTYPE ▴</button>;
  return <div className="proto-bar" role="toolbar" aria-label="原型切换">
    <span className="proto-tag">PROTOTYPE</span>
    <span className="proto-group"><button onClick={() => setChrome(c => cycle(chromes, c, -1))}>‹</button><span>外框 <b>{chromes.find(c => c.key === chrome)!.name}</b></span><button onClick={() => setChrome(c => cycle(chromes, c, 1))}>›</button></span>
    <span className="proto-group"><button onClick={() => setDock(d => cycle(docks, d, -1))}>‹</button><span>平时放在 <b>{docks.find(d => d.key === dock)!.name}</b></span><button onClick={() => setDock(d => cycle(docks, d, 1))}>›</button></span>
    <span className="proto-group"><button onClick={() => setView(v => cycle(views, v, -1))}>‹</button><span>打开时 <b>{views.find(v => v.key === view)!.name}</b></span><button onClick={() => setView(v => cycle(views, v, 1))}>›</button></span>
    {view === 'column' && <span className="proto-group"><span>分栏</span>{columnModes.map(m => <button key={m.key} className={columnMode === m.key ? 'proto-on' : ''} onClick={() => setColumnMode(m.key)}>{m.name}</button>)}</span>}
    <button onClick={addEphemeral} disabled={!canAdd}>＋临时</button>
    <button onClick={() => setRunning(r => !r)}>{running ? '暂停模拟' : '继续模拟'}</button>
    <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☾' : '☀'}</button>
    <span className="proto-state">{state}</span>
    <button title="隐藏原型切换条" onClick={() => setHidden(true)}>▾</button>
  </div>;
}
