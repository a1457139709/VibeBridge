import { agentIcons } from './agent-icons';
import { useEffect, useState } from 'react';
import { agentNames, agentTypes, arrange, assignedAgents, type DirectoryResult, type ProjectDraft } from '../shared/model';
import { layoutBoxes } from '../shared/layout';

function Stepper({ label, value, decrease, increase, canDecrease, canIncrease }: { label: string; value: number; decrease(): void; increase(): void; canDecrease: boolean; canIncrease: boolean }) {
  return <div className="stepper"><button type="button" aria-label={`减少${label}`} disabled={!canDecrease} onClick={decrease}>−</button><output>{value}</output><button type="button" aria-label={`增加${label}`} disabled={!canIncrease} onClick={increase}>＋</button></div>;
}
export function Setup({ draft, change, named, setNamed, cancel, created, report }: { draft: ProjectDraft; change(draft: ProjectDraft): void; named: boolean; setNamed(named: boolean): void; cancel(): void; created(id: string): void; report(message: string): void }) {
  const [directory, setDirectory] = useState<DirectoryResult>({ valid: false });
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const assigned = agentTypes.reduce((sum, type) => sum + draft.counts[type], 0);
  useEffect(() => {
    let live = true;
    setChecking(true); setDirectory({ valid: false });
    const timer = setTimeout(() => {
      void window.workbench.inspectDirectory(draft.directory).then(result => {
        if (live) { setDirectory(result); setChecking(false); }
      }).catch(error => { if (live) { report(error.message); setChecking(false); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [draft.directory]);
  const setPath = (path: string) => change({ ...draft, directory: path, name: named ? draft.name : path.replace(/\/+$/, '').split('/').at(-1) || '' });
  const types = assignedAgents(draft);
  const preview = Array.from({ length: Math.max(draft.total, assigned) }, (_, index) => String(index));
  const boxes = layoutBoxes(arrange(preview)).panels;
  async function submit() {
    setBusy(true);
    try { created((await window.workbench.createProject(draft)).project.id); }
    catch (error) { report((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="setup-scroll"><form className="setup" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h1>创建项目</h1><p className="muted intro">选择一个本地目录，开始并行工作。</p>
    <label htmlFor="project-name">项目名称</label><input id="project-name" value={draft.name} onChange={event => { setNamed(true); change({ ...draft, name: event.target.value }); }} autoComplete="off" />
    <label htmlFor="project-directory">本地目录</label><div className="directory-input"><input id="project-directory" value={draft.directory} onChange={event => setPath(event.target.value)} placeholder="/Users/you/Projects/my-project" autoComplete="off" /><button type="button" aria-label="选择本地目录" onClick={() => void window.workbench.chooseDirectory().then(path => { if (path) setPath(path); }).catch(error => report(error.message))}>浏览</button></div>
    <div className="directory-status" aria-live="polite">{checking ? '检查目录…' : draft.directory && !directory.valid ? <span className="error-text">请选择有效的本地目录</span> : directory.existingProjectId ? <button type="button" className="text-button" onClick={() => created(directory.existingProjectId!)}>打开已有项目 →</button> : '\u00a0'}</div>
    <hr /><label>自动排布预览</label><div className="preview" style={{ height: Math.max(264, Math.ceil(preview.length / 2) * 72) }} aria-label="只读排布预览">
      {preview.map((id, index) => { const box = boxes.get(id)!; const type = types[index]; return <div className={`preview-panel ${type || ''}`} key={id} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="agent-mark">{type ? agentIcons[type] : '＋'}</span><span>{type ? agentNames[type] : '待分配'}</span><small>{index + 1}</small></div>; })}
    </div>
    <div className="quantity-row"><span>窗口数量</span><Stepper label="窗口数量" value={draft.total} decrease={() => change({ ...draft, total: draft.total - 1 })} increase={() => change({ ...draft, total: draft.total + 1 })} canDecrease={draft.total > 1} canIncrease={draft.total < 10} /></div>
    <label className="allocation-label">分配 Agent</label>{agentTypes.map(type => <div className={`quantity-row ${type}`} key={type}><span><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</span><Stepper label={agentNames[type]} value={draft.counts[type]} decrease={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] - 1 } })} increase={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] + 1 } })} canDecrease={draft.counts[type] > 0} canIncrease={assigned < draft.total} /></div>)}
    <div className="allocation-status" aria-live="polite"><span>已分配 {assigned} / {draft.total}</span><span className={assigned > draft.total ? 'error-text' : 'muted'}>{assigned < draft.total ? `还需分配 ${draft.total - assigned} 个` : assigned > draft.total ? `多分配了 ${assigned - draft.total} 个` : '分配完成'}</span></div>
    <div className="setup-actions"><button type="button" onClick={cancel} disabled={busy}>取消</button><button className="primary" type="submit" disabled={busy || checking || !directory.valid || !!directory.existingProjectId || !draft.name.trim() || assigned !== draft.total}>{busy ? '正在创建…' : '创建并启动'}</button></div>
  </form></div>;
}
