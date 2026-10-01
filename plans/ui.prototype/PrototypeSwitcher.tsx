import { useEffect } from 'react';
import type { PrototypeState } from './model.prototype';
import { model, VARIANTS } from './model.prototype';
import type { Variant } from './bridge.prototype';
import { Icon } from './icons.prototype';

const variants: Variant[] = ['A', 'B', 'C'];
export function PrototypeSwitcher({ state, debug, onDebug }: { state: PrototypeState; debug: boolean; onDebug: () => void }) {
  const cycle = (step: number) => model.setVariant(variants[(variants.indexOf(state.variant) + step + variants.length) % variants.length]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable], .xterm')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [state.variant]);
  if (!import.meta.env.DEV) return null;
  const active = model.active();
  return <aside className="prototype-toolbar" aria-label="原型方案切换">
    <span className="prototype-tag">原型</span>
    <div className="prototype-cycle">
      <button className="icon-button" onClick={() => cycle(-1)} aria-label="上一种方案"><Icon name="left" size={16} /></button>
      <button className="variant-label" onClick={() => cycle(1)} title={`${VARIANTS[state.variant].name} / 全局设置页`}><b>{state.variant}</b><span>{VARIANTS[state.variant].name}</span></button>
      <button className="icon-button" onClick={() => cycle(1)} aria-label="下一种方案"><Icon name="right" size={16} /></button>
    </div>
    <div className="prototype-state" title={`焦点 ${state.focusId ?? '无'} · 放大 ${state.maximizedId ?? '无'}`}>{active.panels.length} panels<span>·</span>{Object.keys(state.runs).length} runs</div>
    <button className={`debug-trigger ${debug ? 'active' : ''}`} onClick={onDebug}><Icon name="debug" size={15} />调试</button>
  </aside>;
}
