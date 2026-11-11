import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { agentNames, projectPanels, type AgentType, type PanelView, type ProjectView } from '../shared/model';
import type { IssueSummary } from '../shared/code-hosting';
import type { DispatchLocation, DispatchRecordView, DispatchRequest } from '../shared/dispatch';
import { workflowCatalog, type Delivery, type Workflow, type WorkflowInstruction, type WorkflowSettings } from '../shared/workflows';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import { relativeTime } from './relative-time';
import { useLocalization } from './Localization';
import './dispatch.css';

/** A panel the menu can dispatch to: one of the project's panels whose Agent is running. */
interface Target { panel: PanelView; location: DispatchLocation }
const targets = (project: ProjectView): Target[] => projectPanels(project).flatMap(panel => panel.run?.state === 'running'
  ? [{ panel, location: { projectId: project.id, panelId: panel.id, runId: panel.run.id, ephemeral: project.tray.includes(panel) } }] : []);

// The order the spec lists new panels in.
const newPanelAgents: AgentType[] = ['claude', 'codex', 'pi'];
const flipped = (delivery: Delivery): Delivery => delivery === 'submit' ? 'fill' : 'submit';

/**
 * The issue's 派发 button and its cascading menu: the instructions of enabled workflows, then, to the left, the targets
 * for the chosen one. Nothing is preselected. ⌥ while clicking a target inverts the delivery once. A submitted dispatch
 * returns focus to the button; a filled one locates its panel.
 */
export function DispatchMenu({ issue, project, workflows, dispatch, locate }: {
  issue: IssueSummary; project: ProjectView; workflows: WorkflowSettings;
  dispatch(request: DispatchRequest): Promise<void>; locate(location: DispatchLocation): void;
}) {
  const { t, text } = useLocalization();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ workflow: Workflow; instruction: WorkflowInstruction }>();
  const [failure, setFailure] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const enabled = workflowCatalog.filter(workflow => workflows[workflow.id]?.enabled);
  const close = () => { setOpen(false); setChosen(undefined); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const delivery = (workflow: Workflow, instruction: WorkflowInstruction): Delivery => workflows[workflow.id]?.instructions[instruction.id]?.delivery ?? 'submit';
  async function send(target: Target, event: MouseEvent) {
    if (!chosen) return;
    const invert = event.altKey;
    const effective = invert ? flipped(delivery(chosen.workflow, chosen.instruction)) : delivery(chosen.workflow, chosen.instruction);
    close(); setFailure(undefined);
    try {
      await dispatch({ issue: { number: issue.number, title: issue.title }, workflow: chosen.workflow.id, instruction: chosen.instruction.id,
        target: { panelId: target.panel.id }, invert });
      if (effective === 'fill') locate(target.location); else button.current?.focus();
    } catch (error) { setFailure((error as Error).message); button.current?.focus(); }
  }
  const instructions = (workflow: Workflow) => workflow.instructions.map(instruction => {
    const mode = delivery(workflow, instruction);
    const current = chosen?.instruction === instruction;
    return [instruction.separatorBefore && <hr key={`${instruction.id}-separator`} />,
      <button key={instruction.id} role="menuitem" aria-haspopup="menu" aria-expanded={current} className={current ? 'chosen' : undefined}
        onMouseEnter={() => setChosen({ workflow, instruction })} onClick={() => setChosen({ workflow, instruction })}>
        <code>{instruction.skill}</code><small className={`dispatch-delivery ${mode}`}>{t(mode === 'submit' ? 'deliverySubmit' : 'deliveryFill')}</small>
      </button>];
  });
  return <div className="dispatch" ref={root}>
    <button ref={button} className="dispatch-button" aria-haspopup="menu" aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>{t('dispatch')}</button>
    {open && <div className="dispatch-menu" role="menu" aria-label={t('dispatchIssue', { number: issue.number })}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); button.current?.focus(); } }}>
      {!enabled.length && <p className="dispatch-empty">{t('noEnabledWorkflows')}</p>}
      {enabled.length === 1 && instructions(enabled[0])}
      {enabled.length > 1 && enabled.map(workflow => <div key={workflow.id} role="group" aria-label={workflow.name}>
        <div className="dispatch-heading" aria-hidden="true">{workflow.name}</div>{instructions(workflow)}</div>)}
      {chosen && <div className="dispatch-targets" role="menu" aria-label={t('dispatchTargets', { instruction: chosen.instruction.skill })}>
        {/* New panels are dispatched to by the next step of this feature. */}
        {newPanelAgents.map(agent => <button key={agent} role="menuitem" disabled aria-label={t('newPanelTarget', { agent: agentNames[agent] })}>
          <span className="agent-mark">{agentIcons[agent]}</span><span className="dispatch-target-title">{t('newPanelTarget', { agent: agentNames[agent] })}</span>
        </button>)}
        <hr />
        {targets(project).map(target => {
          const { panel } = target;
          const title = panel.run?.title ?? t('untitled');
          const side = t(target.location.ephemeral ? 'ephemeralPanel' : 'residentPanel');
          return <button key={panel.id} role="menuitem" aria-label={`${title} · ${t(panel.status ?? 'error')} · ${agentNames[panel.agent]} · ${side}`}
            onClick={event => void send(target, event)}>
            <span className="agent-mark">{agentIcons[panel.agent]}</span><ProcessingStatusIcon state={panel.status} />
            <span className="dispatch-target-title">{title}</span><small>{side}</small>
          </button>;
        })}
      </div>}
    </div>}
    {failure && <p className="error-text" role="alert">{text(failure)}</p>}
  </div>;
}

/**
 * The issue's latest Dispatch Record: the panel now on its session, with its processing state, session title and how
 * many dispatches the issue had, or a grey dispatched time. Clicking locates the latest dispatch a panel is on now.
 * A closed issue shows none.
 */
export function DispatchStatus({ issue, records, locate }: { issue: IssueSummary; records: DispatchRecordView[]; locate(location: DispatchLocation): void }) {
  const { t, language } = useLocalization();
  const [latest] = records;
  if (issue.state === 'closed' || !latest) return null;
  const time = new Date(latest.time);
  const dispatched = t('dispatchedAt', { time: relativeTime(time, language) });
  const summary = t('dispatchSummary', { title: latest.location ? latest.location.title ?? t('untitled') : dispatched,
    agent: agentNames[latest.agent], time: time.toLocaleString(language), text: latest.text });
  const target = records.find(record => record.location)?.location;
  return <button className="issue-dispatch" aria-label={t('locateDispatch', { summary })} data-hint={summary}
    onClick={() => { if (target) locate(target); }}>
    {latest.location ? <>
      <ProcessingStatusIcon state={latest.location.status} />
      <span className="issue-dispatch-title">{latest.location.title ?? t('untitled')}</span>
      {records.length > 1 && <span className="issue-dispatch-count">{t('dispatchCount', { count: records.length })}</span>}
    </> : <span className="issue-dispatched">{dispatched}</span>}
  </button>;
}
