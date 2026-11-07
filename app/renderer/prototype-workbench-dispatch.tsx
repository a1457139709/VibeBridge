// PROTOTYPE — throwaway, part of prototype-workbench.tsx (branch `prototype/workbench`). Never import or adapt into production
// (AGENTS.md「Prototype scope」). The built-in workflow (#143) and the cascading dispatch menu (#142, keys revised by #157).
import React, { useEffect, useRef, useState } from 'react';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import { agentName, statusName, type Agent } from './prototype-ephemeral-panels-data';
import type { Issue, Pane } from './prototype-github-sidebar-model';

export type Mode = 'submit' | 'fill';
export interface Command { skill: string; args: string }
export const mattCommands: (Command | 'separator')[] = [
  { skill: 'grill-with-docs', args: '{url}' }, { skill: 'to-spec', args: '{url}' }, { skill: 'to-tickets', args: '{url}' }, { skill: 'implement', args: '{url}' },
  { skill: 'implement-spec', args: '{url}' }, { skill: 'wayfinder', args: '{url}' }, { skill: 'triage', args: 'look at {url}' },
  'separator',
  { skill: 'diagnosing-bugs', args: '{url}' }, { skill: 'tdd', args: '{url}' }, { skill: 'prototype', args: '{url}' }, { skill: 'research', args: '{url}' }, { skill: 'grill-me', args: '{url}' },
];
export interface WorkflowSettings { enabled: boolean; modes: Record<string, Mode> }
export const initialWorkflow: WorkflowSettings = { enabled: true, modes: {} }; // every command defaults to 提交
export const modeOf = (w: WorkflowSettings, skill: string): Mode => w.modes[skill] ?? 'submit';
export const modeName: Record<Mode, string> = { submit: '提交', fill: '只填入' };
export const flip = (m: Mode): Mode => m === 'submit' ? 'fill' : 'submit';

/** Each Agent type writes "call a skill" its own way (#141, #143). */
export function inputFor(agent: Agent, c: Command, url: string) {
  const args = c.args.replace('{url}', url);
  return agent === 'claude' ? `/${c.skill} ${args}` : agent === 'codex' ? `$${c.skill} ${args}` : `/skill:${c.skill} ${args}`;
}

export type Target = { kind: 'new'; agent: Agent } | { kind: 'pane'; id: string };
const targetKey = (t: Target) => t.kind === 'new' ? `new:${t.agent}` : t.id;
const agents: Agent[] = ['claude', 'codex', 'pi'];

/**
 * One 派发 button, no default command. Opens the cascade beside it: commands, then (leftwards) targets.
 * ↑/↓ move, ← enters the second layer (Space on the first layer does the same), → goes back, Space dispatches,
 * ⌥+Space or ⌥+click flips 提交/只填入 this once, Esc closes the whole menu, Enter does nothing.
 */
export function DispatchButton({ issue, panes, workflow, lastTarget, open, onOpen, onClose, onDispatch, weak = false, size = 'row' }: {
  issue: Issue; panes: Pane[]; workflow: WorkflowSettings; lastTarget: Record<string, string>; open: boolean;
  onOpen(): void; onClose(): void; onDispatch(command: Command, target: Target, mode: Mode, back: () => void): void; weak?: boolean; size?: 'row' | 'detail';
}) {
  const commands = workflow.enabled ? mattCommands : [];
  const items = commands.filter((c): c is Command => c !== 'separator');
  const targets: Target[] = [...agents.map(agent => ({ kind: 'new', agent }) as Target), ...panes.map(p => ({ kind: 'pane', id: p.id }) as Target)];
  const [level, setLevel] = useState<1 | 2>(1);
  const [i1, setI1] = useState(0);
  const [i2, setI2] = useState(0);
  const [alt, setAlt] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const back = () => button.current?.focus();
  const close = () => { onClose(); setLevel(1); back(); };
  const remembered = (c: Command) => Math.max(0, targets.findIndex(t => targetKey(t) === (lastTarget[c.skill] ?? 'new:claude')));
  const enter = (k = i1) => { if (!items[k]) return; setI1(k); setI2(remembered(items[k])); setLevel(2); };
  const fire = (k: number, t: number, flipped: boolean) => {
    const c = items[k]; if (!c) return;
    const mode = flipped ? flip(modeOf(workflow, c.skill)) : modeOf(workflow, c.skill);
    onClose(); setLevel(1); onDispatch(c, targets[t], mode, back);
  };

  useEffect(() => { if (open) { setLevel(1); setI1(0); setTimeout(() => menu.current?.focus()); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    const alts = (e: KeyboardEvent) => setAlt(e.altKey);
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', alts); window.addEventListener('keyup', alts);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', alts); window.removeEventListener('keyup', alts); setAlt(false); };
  }, [open, onClose]);

  const keydown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keys never reach the terminal while the menu is open
    const move = (d: number) => level === 1 ? setI1(i => Math.min(items.length - 1, Math.max(0, i + d))) : setI2(i => Math.min(targets.length - 1, Math.max(0, i + d)));
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (level === 1) enter(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setLevel(1); }
    else if (e.key === ' ') { e.preventDefault(); if (level === 1) enter(); else fire(i1, i2, e.altKey); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') e.preventDefault();
  };

  const current = items[i1];
  const describe = (t: Target) => {
    if (t.kind === 'new') return { agent: t.agent, title: `新建 · ${agentName[t.agent]}`, side: '临时' };
    const p = panes.find(x => x.id === t.id)!;
    return { agent: p.agent, title: p.title, side: p.ephemeral ? '临时' : '常驻', status: p.status };
  };
  const preview = current && level === 2 && targets[i2] ? inputFor(describe(targets[i2]).agent, current, `https://github.com/…/issues/${issue.number}`) : undefined;
  let k = -1;
  return <div className={`gh-split wb-dispatch ${weak ? 'weak' : ''} ${size}`} ref={root} onClick={e => e.stopPropagation()}>
    <button ref={button} className="gh-split-main" aria-expanded={open} title="选择指令和目标（⌘D）" onClick={() => open ? onClose() : onOpen()}>派发 ▾</button>
    {open && <div className="wb-menu" ref={menu} tabIndex={-1} onKeyDown={keydown} role="menu" aria-label={`派发 #${issue.number}`}>
      <div className="wb-menu-list">
        {!items.length && <div className="wb-menu-empty">没有开启的工作流，可在 设置 › 工作流 中开启</div>}
        {commands.map((c, n) => {
          if (c === 'separator') return <hr key={`s${n}`} />;
          const at = ++k; const mode = alt ? flip(modeOf(workflow, c.skill)) : modeOf(workflow, c.skill);
          return <button key={c.skill} role="menuitem" className={`${at === i1 ? 'on' : ''} ${at === i1 && level === 2 ? 'expanded' : ''}`}
            onMouseEnter={() => enter(at)} onClick={() => enter(at)}>
            <span className="wb-caret">‹</span><code>{c.skill}</code><small className={`wb-mode ${mode}`}>{modeName[mode]}</small></button>;
        })}
      </div>
      {level === 2 && current && <div className="wb-menu-sub" style={{ top: Math.max(0, i1 * 26) }}>
        {targets.map((t, n) => {
          const d = describe(t);
          return <React.Fragment key={targetKey(t)}>
            {n === agents.length && <hr />}
            <button role="menuitem" className={`${n === i2 ? 'on' : ''} ${targetKey(t) === (lastTarget[current.skill] ?? 'new:claude') ? 'last' : ''}`}
              onMouseEnter={() => setI2(n)} onClick={e => fire(i1, n, e.altKey)}>
              <span className="agent-mark">{agentIcons[d.agent]}</span>
              {d.status && <ProcessingStatusIcon state={d.status} />}
              <span className="gh-ellipsis">{d.title}</span>
              <small>{d.status ? `${statusName[d.status]} · ${d.side}` : d.side}</small>
            </button>
          </React.Fragment>;
        })}
        {preview && <div className="wb-menu-preview"><code>{preview}</code><span>{modeName[alt ? flip(modeOf(workflow, current.skill)) : modeOf(workflow, current.skill)]}{alt ? '（⌥ 反转）' : ''}</span></div>}
      </div>}
      <div className="wb-menu-keys">↑↓ 移动 · ← 进入 · → 退回 · Space 执行 · ⌥ 反转 · Esc 关闭</div>
    </div>}
  </div>;
}
