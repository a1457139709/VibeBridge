import { agentIcons } from './agent-icons';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { agentNames, agentTypes, arrange, assignedAgents, type DefaultLayout, type DirectoryResult, type ProjectDraft } from '../shared/model';
import { layoutBoxes } from '../shared/layout';
import { projectNameError, projectNameFromDirectory, projectNameHasControls } from '../shared/project-name';

function Stepper({ label, value, decrease, increase, canDecrease, canIncrease }: { label: string; value: number; decrease(): void; increase(): void; canDecrease: boolean; canIncrease: boolean }) {
  return <div className="stepper"><button type="button" aria-label={`减少${label}`} disabled={!canDecrease} onClick={decrease}>−</button><output>{value}</output><button type="button" aria-label={`增加${label}`} disabled={!canIncrease} onClick={increase}>＋</button></div>;
}
export function Setup({ draft, change, cancel, created, openProject, report, defaultLayout }: { draft: ProjectDraft; change: Dispatch<SetStateAction<ProjectDraft>>; cancel(): void; created(id: string): void; openProject(id: string): void; report(message: string): void; defaultLayout: DefaultLayout }) {
  const [inspection, setInspection] = useState<{ path: string; result: DirectoryResult }>();
  const [nameTouched, setNameTouched] = useState(false);
  const [directoryTouched, setDirectoryTouched] = useState(false);
  const [nameInputError, setNameInputError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const directory = inspection?.path === draft.directory ? inspection.result : undefined;
  const checking = !!draft.directory && !directory;
  const nameError = projectNameError(draft.name);
  const nameMessage = nameInputError || (nameTouched || draft.name.trim() ? nameError : '');
  const directoryMessage = !draft.directory ? (directoryTouched ? '请选择项目目录' : '')
    : checking ? '' : !directory?.valid ? '请选择有效的本地目录'
    : directory.existingProjectId ? `此目录已添加为项目『${directory.existingProjectName}』，无法重复创建` : '';
  const assigned = agentTypes.reduce((sum, type) => sum + draft.counts[type], 0);
  const canCreate = !busy && !choosing && !!directory?.valid && !directory.existingProjectId && !nameError && !nameInputError && assigned === draft.total;
  useEffect(() => {
    setInspection(undefined);
    if (!draft.directory) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.workbench.inspectDirectory(draft.directory).then(result => {
        if (live) setInspection({ path: draft.directory, result });
      }).catch(error => { if (live) { setInspection({ path: draft.directory, result: { valid: false } }); report(error.message); } });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [draft.directory]);
  async function chooseDirectory() {
    setChoosing(true);
    try {
      const path = await window.workbench.chooseDirectory();
      if (path === null) return;
      change(current => ({ ...current, directory: path, name: current.name.trim() ? current.name : projectNameFromDirectory(path) }));
      setNameInputError(''); setNameTouched(true); setDirectoryTouched(true);
    } catch (error) { report((error as Error).message); }
    finally { setChoosing(false); }
  }
  const types = assignedAgents(draft);
  const preview = Array.from({ length: Math.max(draft.total, assigned) }, (_, index) => String(index));
  const boxes = layoutBoxes(arrange(preview, defaultLayout)).panels;
  async function submit() {
    if (!canCreate) { setNameTouched(true); setDirectoryTouched(true); return; }
    setBusy(true);
    try { created((await window.workbench.createProject(draft)).project.id); }
    catch (error) { report((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="setup-scroll"><form className="setup" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h1>创建项目</h1><p className="muted intro">选择一个本地目录，开始并行工作。</p>
    <label htmlFor="project-name">项目名称</label><input id="project-name" value={draft.name} aria-invalid={!!nameMessage} aria-describedby="project-name-status" onBlur={() => setNameTouched(true)} onChange={event => { setNameInputError(''); change({ ...draft, name: event.target.value }); }} onPaste={event => {
      const text = event.clipboardData.getData('text');
      if (projectNameHasControls(text)) { event.preventDefault(); setNameInputError('项目名称不能包含换行或控制字符'); }
      else setNameInputError('');
    }} autoComplete="off" />
    <div id="project-name-status" className="field-status" hidden={!nameMessage} aria-live="polite">{nameMessage && <span className="error-text">{nameMessage}</span>}</div>
    <label htmlFor="project-directory">本地目录</label><div className="directory-input"><input id="project-directory" value={draft.directory} aria-invalid={!!directoryMessage} aria-describedby="project-directory-status" onBlur={() => setDirectoryTouched(true)} onChange={event => change({ ...draft, directory: event.target.value })} placeholder="/Users/you/Projects/my-project" autoComplete="off" /><button type="button" aria-label="选择本地目录" disabled={choosing} onClick={() => void chooseDirectory()}>浏览</button></div>
    <div id="project-directory-status" className="directory-status field-status" aria-live="polite">
      {checking ? '检查目录…' : directoryMessage && <span className="error-text">{directoryMessage}</span>}
      {directory?.existingProjectId && <button type="button" className="open-existing-project" onClick={() => openProject(directory.existingProjectId!)}>打开已有项目</button>}
    </div>
    <hr /><label>自动排布预览</label><div className="preview" style={{ height: Math.max(264, Math.ceil(preview.length / 2) * 72) }} aria-label="只读排布预览">
      {preview.map((id, index) => { const box = boxes.get(id)!; const type = types[index]; return <div className={`preview-panel ${type || ''}`} key={id} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="agent-mark">{type ? agentIcons[type] : '＋'}</span><span>{type ? agentNames[type] : '待分配'}</span><small>{index + 1}</small></div>; })}
    </div>
    <div className="quantity-row"><span>窗口数量</span><Stepper label="窗口数量" value={draft.total} decrease={() => change({ ...draft, total: draft.total - 1 })} increase={() => change({ ...draft, total: draft.total + 1 })} canDecrease={draft.total > 1} canIncrease={draft.total < 10} /></div>
    <label className="allocation-label">分配 Agent</label>{agentTypes.map(type => <div className={`quantity-row ${type}`} key={type}><span><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</span><Stepper label={agentNames[type]} value={draft.counts[type]} decrease={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] - 1 } })} increase={() => change({ ...draft, counts: { ...draft.counts, [type]: draft.counts[type] + 1 } })} canDecrease={draft.counts[type] > 0} canIncrease={assigned < draft.total} /></div>)}
    <div className="allocation-status" aria-live="polite"><span>已分配 {assigned} / {draft.total}</span><span className={assigned > draft.total ? 'error-text' : 'muted'}>{assigned < draft.total ? `还需分配 ${draft.total - assigned} 个` : assigned > draft.total ? `多分配了 ${assigned - draft.total} 个` : '分配完成'}</span></div>
    <div className="setup-actions"><button type="button" onClick={cancel} disabled={busy}>取消</button><button className="primary" type="submit" disabled={!canCreate}>{busy ? '正在创建…' : '创建并启动'}</button></div>
  </form></div>;
}
