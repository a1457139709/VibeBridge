// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// The settings page with the two new settings (#155) and the edit-project dialog where a repository is bound (#140).
import React, { useState } from 'react';
import { mattCommands, modeName, modeOf, type Command, type Mode, type WorkflowSettings } from './prototype-workbench-dispatch';

export type Fit = 'overlay' | 'push';
const categories = ['通用', 'Agent', '工作流', '外观', '快捷键'] as const;
type Category = typeof categories[number];

export function SettingsPage({ fit, setFit, workflow, setWorkflow }: { fit: Fit; setFit(f: Fit): void; workflow: WorkflowSettings; setWorkflow(update: (w: WorkflowSettings) => WorkflowSettings): void }) {
  const [category, setCategory] = useState<Category>('工作流');
  const [expanded, setExpanded] = useState(true);
  const setMode = (skill: string, mode: Mode) => setWorkflow(w => ({ ...w, modes: { ...w.modes, [skill]: mode } }));
  return <div className="wb-settings">
    <nav className="wb-settings-nav">{categories.map(c => <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>)}</nav>
    <div className="wb-settings-body">
      <h2>{category}</h2>
      {(category === '通用' || category === 'Agent') && <p className="muted">（现有设置，原型不展开。）</p>}
      {category === '工作流' && <>
        <p className="muted">工作流由工作台内置。派发菜单只列出已开启工作流的指令；派发时按住 ⌥ 只反转这一次的「提交 / 只填入」。</p>
        <section className="wb-card">
          <div className="wb-setting-row">
            <button className="gh-text-button" onClick={() => setExpanded(e => !e)}>{expanded ? '▾' : '▸'}</button>
            <div className="wb-setting-text"><b>Matt 的流程</b><span className="muted">12 条指令 · 每条都用 issue 的 {'{url}'} 作参数</span></div>
            <label className="wb-switch"><input type="checkbox" checked={workflow.enabled} onChange={e => setWorkflow(w => ({ ...w, enabled: e.target.checked }))} /><span>{workflow.enabled ? '已开启' : '已关闭'}</span></label>
          </div>
          {expanded && <div className={`wb-commands ${workflow.enabled ? '' : 'off'}`}>{mattCommands.map((c, n) => c === 'separator' ? <hr key={n} /> :
            <div key={c.skill} className="wb-command"><code>{(c as Command).skill} {(c as Command).args}</code>
              <span className="wb-seg">{(['submit', 'fill'] as Mode[]).map(m => <button key={m} className={modeOf(workflow, c.skill) === m ? 'on' : ''} onClick={() => setMode(c.skill, m)}>{modeName[m]}</button>)}</span>
            </div>)}</div>}
        </section>
      </>}
      {category === '外观' && <>
        <p className="muted">（默认布局等现有设置略。）</p>
        <section className="wb-card"><div className="wb-setting-row column">
          <b>GitHub 侧边栏与布局区域</b>
          <label className="wb-radio"><input type="radio" checked={fit === 'overlay'} onChange={() => setFit('overlay')} /><span><b>覆盖</b>（默认）：侧边栏盖在布局区域右侧，面板尺寸不变；工作区工具栏和托盘让出位置。</span></label>
          <label className="wb-radio"><input type="radio" checked={fit === 'push'} onChange={() => setFit('push')} /><span><b>挤压</b>：布局区域变窄，面板跟着重新排布。</span></label>
          <span className="muted">不论选哪种，issue 详情都盖在布局区域上。</span>
        </div></section>
      </>}
      {category === '快捷键' && <table className="wb-keys"><tbody>
        <tr><td>聚焦上一个 / 下一个面板</td><td><kbd>⌘[</kbd> / <kbd>⌘]</kbd></td><td className="muted">现有</td></tr>
        <tr className="new"><td>开关 GitHub 侧边栏</td><td><kbd>⌘⌥B</kbd></td><td className="muted">新增 · 任何时候</td></tr>
        <tr className="new"><td>打开派发菜单</td><td><kbd>⌘D</kbd></td><td className="muted">新增 · 焦点在侧边栏且选中了 issue</td></tr>
        <tr className="new"><td>定位派发的面板</td><td><kbd>⌘L</kbd></td><td className="muted">新增 · 同上</td></tr>
      </tbody></table>}
    </div>
  </div>;
}

export type GhState = 'bound' | 'unbound' | 'no-gh' | 'logged-out' | 'no-access' | 'stale';
export const ghStates: { key: GhState; name: string }[] = [
  { key: 'bound', name: '已绑定' }, { key: 'unbound', name: '未绑定' }, { key: 'no-gh', name: '未安装 gh' },
  { key: 'logged-out', name: '未登录' }, { key: 'no-access', name: '无法访问' }, { key: 'stale', name: '暂时失败' },
];

/** #140: bind, change or unbind in the edit-project dialog; only repos the active `gh` account can see; no free text. */
export function EditProjectDialog({ repo, bound, gh, onSave, onClose }: { repo: string; bound?: string; gh: GhState; onSave(repo?: string): void; onClose(): void }) {
  const owner = repo.split('/')[0];
  const choices = [repo, `${owner}/blog`, `${owner}/dotfiles`, `${owner}/notes`, 'acme-org/platform', 'acme-org/design-system'];
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(bound ?? repo); // origin points at `repo`, so it starts selected
  const [confirm, setConfirm] = useState<'change' | 'unbind'>();
  const save = () => { if (bound && picked !== bound) setConfirm('change'); else { onSave(picked); onClose(); } };
  const ghBroken = gh === 'no-gh' || gh === 'logged-out';
  return <div className="wb-modal-back" onMouseDown={onClose}><div className="wb-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="编辑项目">
    <h3>编辑项目</h3>
    <label className="wb-field"><span>名称</span><input defaultValue="VibeBridge" /></label>
    <label className="wb-field"><span>目录</span><input readOnly value="/Users/red/Project/VibeBridge" /></label>
    <div className="wb-field"><span>GitHub 仓库</span>
      {ghBroken ? <div className="wb-gh-error">{gh === 'no-gh' ? <>没有找到 <code>gh</code>，安装后才能绑定。<a href="https://cli.github.com" target="_blank" rel="noreferrer">安装说明 ↗</a></> : <>gh 未登录。在终端运行 <code>gh auth login</code> 后重试。</>}
        <button className="gh-btn">重试</button></div>
        : <div className="wb-picker">
          <input placeholder="搜索仓库" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
          <div className="wb-picker-list">{choices.filter(c => c.includes(query.trim())).map(c => <button key={c} className={picked === c ? 'on' : ''} onClick={() => setPicked(c)}>
            <span className="gh-ellipsis">{c}</span>{c === repo && <small>origin</small>}{c === bound && <small>当前</small>}</button>)}</div>
          <span className="muted">列表来自 gh 当前账号自己的、作为协作者的、所在组织的仓库。</span>
        </div>}
    </div>
    {confirm && <div className="wb-confirm">{confirm === 'change' ? `把绑定从 ${bound} 改为 ${picked}？旧仓库的派发记录会隐藏但保留。` : `解绑 ${bound}？派发记录保留。`}
      <span className="gh-spacer" /><button className="gh-btn" onClick={() => setConfirm(undefined)}>取消</button>
      <button className="gh-btn primary" onClick={() => { onSave(confirm === 'unbind' ? undefined : picked); onClose(); }}>{confirm === 'change' ? '修改' : '解绑'}</button></div>}
    <footer>{bound && <button className="gh-btn danger" onClick={() => setConfirm('unbind')}>解绑</button>}<span className="gh-spacer" />
      <button className="gh-btn" onClick={onClose}>取消</button><button className="gh-btn primary" disabled={ghBroken} onClick={save}>保存</button></footer>
  </div></div>;
}
