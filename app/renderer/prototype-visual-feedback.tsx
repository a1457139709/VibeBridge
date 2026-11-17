// PROTOTYPE — throwaway, lives only on branch `prototype/visual-feedback`. Never import or adapt into production (AGENTS.md「Prototype scope」).
// #223 (map #217): four independent questions on the workbench prototype, each with its own variants, switched from the
// floating bar at the bottom or the URL hash, e.g. `#graph=c&toggle=b&row=b&tray=d`. A is always main as QA saw it.
import React, { useEffect, useState } from 'react';

export type Axis = 'graph' | 'toggle' | 'row' | 'tray';
interface Variant { key: string; name: string; note: string }
export const axes: { key: Axis; name: string; qa: string; variants: Variant[] }[] = [
  { key: 'graph', name: '关系图', qa: 'QA #7', variants: [
    { key: 'a', name: '现状', note: '节点与详情同底，连线一律琥珀色，只有本 issue 加描边。' },
    { key: 'b', name: '底板', note: '整张图放在带边框的浅底板上，节点边框加深；颜色不表达关系。' },
    { key: 'c', name: '按关系上色', note: '被阻塞于 = 红，阻塞了 = 琥珀，本 issue 实心反色；连线与栏头同色。' },
    { key: 'd', name: '分栏底色', note: '三栏各有一条淡色竖带（左红、中性、右琥珀），节点保持中性。' },
  ] },
  { key: 'toggle', name: '工作流开关', qa: 'QA #13', variants: [
    { key: 'a', name: '现状', note: '复选框 +「已开启 / 已关闭」。这是全应用唯一的复选框式开关。' },
    { key: 'b', name: '椭圆开关 + 文字', note: '椭圆开关，左边保留「已开启 / 已关闭」。' },
    { key: 'c', name: '只有椭圆开关', note: '椭圆开关，不带文字；状态只靠滑块位置和颜色。' },
    { key: 'd', name: '分段「开启 | 关闭」', note: '与每条指令的「提交 | 只填入」同一种分段控件。' },
  ] },
  { key: 'row', name: 'issue 行高亮', qa: 'QA #14', variants: [
    { key: 'a', name: '现状', note: '整行淡底 + 左侧细线；键盘聚焦时另给标题加一圈焦点框（浅色主题下几乎只看得到这圈框）。' },
    { key: 'b', name: '整行高亮（读法②）', note: '去掉标题焦点框；列表有焦点时整行加深 + 粗左线，没焦点时退成淡底。' },
    { key: 'c', name: '只高亮标题（读法①）', note: '行不加底色，只给标题文字加一块高亮底。' },
    { key: 'd', name: '整行描边', note: '焦点框从标题移到整行；列表没焦点时只剩淡底。' },
  ] },
  { key: 'tray', name: '托盘收起', qa: 'QA #10', variants: [
    { key: 'a', name: '现状', note: '收起 / 展开都是瞬间切换，卡片只是去掉按下状态。' },
    { key: 'b', name: '缩回卡片', note: '面板缩小飞进自己的卡片，卡片随后闪一下；展开时从卡片放大出来。' },
    { key: 'c', name: '卡片闪烁 + 提示', note: '面板瞬间消失，卡片闪一下，托盘上方浮出「已收起到托盘」提示 2 秒。' },
    { key: 'd', name: '下滑 + 标签相连', note: '打开时卡片像标签一样接在面板底边；收起时面板向下滑进托盘，展开时向上滑出。' },
  ] },
];

export type Variants = Record<Axis, string>;
const read = (): Variants => {
  const hash = new URLSearchParams(location.hash.slice(1)), search = new URLSearchParams(location.search);
  return Object.fromEntries(axes.map(a => {
    const v = (hash.get(a.key) ?? search.get(a.key) ?? 'a').toLowerCase();
    return [a.key, a.variants.some(x => x.key === v) ? v : 'a'];
  })) as Variants;
};
const write = (v: Variants) => history.replaceState(null, '', `${location.pathname}${location.search}#${new URLSearchParams(v)}`);

export function useVariants(): [Variants, (axis: Axis, key: string) => void] {
  const [v, setV] = useState(read);
  useEffect(() => { const follow = () => setV(read()); window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow); }, []);
  return [v, (axis, key) => setV(old => { const next = { ...old, [axis]: key }; write(next); return next; })];
}
export const variantClasses = (v: Variants) => axes.map(a => `vf-${a.key}-${v[a.key]}`).join(' ');

/** The pink bar: one ‹ name › group per question. ← → cycle the active group while focus is not in the app's own controls. */
export function VariantBar({ value, set, onJump }: { value: Variants; set(axis: Axis, key: string): void; onJump(axis: Axis): void }) {
  const [active, setActive] = useState<Axis>('graph');
  const [hidden, setHidden] = useState(false);
  const cycle = (axis: Axis, step: number) => {
    const list = axes.find(a => a.key === axis)!.variants, at = list.findIndex(x => x.key === value[axis]);
    set(axis, list[(at + step + list.length) % list.length].key); setActive(axis);
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && el !== document.body && !el.closest('.vf-bar')) return; // the list, terminals and inputs keep their arrows
      e.preventDefault(); cycle(active, e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  if (hidden) return <button className="vf-bar vf-bar-mini" onClick={() => setHidden(false)}>#223 方案 ▴</button>;
  const current = axes.find(a => a.key === active)!, note = current.variants.find(x => x.key === value[active])!.note;
  return <div className="vf-bar" role="toolbar" aria-label="#223 方案切换">
    <div className="vf-groups">
      {axes.map(a => {
        const v = a.variants.find(x => x.key === value[a.key])!;
        return <span key={a.key} className={`vf-group ${active === a.key ? 'on' : ''}`}>
          <button className="vf-axis" title={`${a.qa}：跳到这一处`} onClick={() => { setActive(a.key); onJump(a.key); }}>{a.name}</button>
          <button className="vf-arrow" title="上一个方案" onClick={() => cycle(a.key, -1)}>‹</button>
          <span className="vf-label" onClick={() => setActive(a.key)}>{v.key.toUpperCase()} {v.name}</span>
          <button className="vf-arrow" title="下一个方案" onClick={() => cycle(a.key, 1)}>›</button>
        </span>;
      })}
      <button className="vf-arrow" title="隐藏" onClick={() => setHidden(true)}>▾</button>
    </div>
    <div className="vf-note"><b>{current.qa} · {current.name} {value[active].toUpperCase()}</b>：{note}<span className="muted">　点组名跳到对应位置；←→ 切换高亮的这一组。</span></div>
  </div>;
}
