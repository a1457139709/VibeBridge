import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocalization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { RelativeTime } from './ForgeDisplay';
import { agentIcons } from './agent-icons';
import { agentNames, liveRun, projectPanels, type AgentType, type PanelView, type ProjectView, type Settings } from '../shared/model';
import { commandDelivery, commandText, workflows, type Delivery, type WorkflowCommand } from '../shared/workflows';
import { latestLocatable, type DispatchRecordView, type DispatchRequest } from '../shared/dispatch';
import type { IssueSummary } from '../shared/forge';
import './dispatch.css';

/** What dispatching needs from the sidebar around it. */
export interface DispatchHost {
  workflows: Settings['workflows'];
  /** Locates a panel; an ephemeral one opens as its temporary maximize. */
  locate(projectId: string, panelId: string): void;
  /** A dispatch went through: the sidebar refreshes once; `fill` also closes the detail. */
  dispatched(delivery: Delivery): void;
  report(message: string): void;
}

/** New-panel targets, in this order; they are listed and disabled. */
const newPanelAgents: AgentType[] = ['claude', 'codex', 'pi'];
const deliveryText = { submit: 'deliverySubmit', fill: 'deliveryFill' } as const;

/** One Dispatch button with no default command. It opens a cascade beside it: the commands of the enabled workflows,
 * then, leftwards, the targets: new panels of each Agent type, and the project's panels that have a run, whatever
 * they are doing. Submitting returns focus here; filling locates the target panel. */
export function DispatchButton({ project, issue, host }: { project: ProjectView; issue: IssueSummary; host: DispatchHost }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  /** The command whose targets show, and how far down the menu its row sits. */
  const [expanded, setExpanded] = useState<{ workflowId: string; command: WorkflowCommand; top: number }>();
  /** The target the pointer is on; the preview shows the text it would receive. */
  const [pointed, setPointed] = useState<PanelView>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); setExpanded(undefined); setPointed(undefined); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    root.current?.addEventListener('keydown', escape);
    const element = root.current;
    return () => { document.removeEventListener('pointerdown', outside); element?.removeEventListener('keydown', escape); };
  }, [open]);

  const enabled = workflows.filter(workflow => host.workflows[workflow.id]?.enabled);
  const delivery = (workflowId: string, command: WorkflowCommand) => commandDelivery(host.workflows, workflowId, command.id);
  const panels = projectPanels(project).filter(panel => liveRun(panel.run));
  const resident = (panel: PanelView) => project.panels.includes(panel);

  async function dispatch(panel: PanelView) {
    if (!expanded) return;
    const request: DispatchRequest = { issue: { number: issue.number, title: issue.title }, workflowId: expanded.workflowId,
      commandId: expanded.command.id, target: { kind: 'panel', panelId: panel.id }, invert: false };
    close();
    try {
      const { delivery } = await window.workbench.dispatch(project.id, request);
      if (delivery === 'fill') host.locate(project.id, panel.id); else button.current?.focus();
      host.dispatched(delivery);
    } catch (error) { host.report((error as Error).message); button.current?.focus(); }
  }

  return <div className="dispatch" ref={root} onClick={event => event.stopPropagation()}>
    <button ref={button} className="dispatch-button" aria-haspopup="menu" aria-expanded={open} data-hint={t('dispatchHint')}
      onClick={() => open ? close() : setOpen(true)}>{t('dispatch')}<span aria-hidden="true"> ▾</span></button>
    {open && <div className="dispatch-menu" role="menu" aria-label={t('dispatchMenu', { number: issue.number })}>
      {!enabled.length && <p className="dispatch-empty">{t('noEnabledWorkflows')}</p>}
      {enabled.map(workflow => <Fragment key={workflow.id}>
        {enabled.length > 1 && <h4 className="dispatch-workflow">{t(workflow.name)}</h4>}
        {workflow.commands.map(command => {
          const mode = delivery(workflow.id, command);
          const on = expanded?.workflowId === workflow.id && expanded.command.id === command.id;
          const expand = (event: React.MouseEvent<HTMLButtonElement>) => { if (!on) { setExpanded({ workflowId: workflow.id, command, top: event.currentTarget.offsetTop }); setPointed(undefined); } };
          return <Fragment key={command.id}>
            {'separatorBefore' in command && <hr />}
            <button role="menuitem" className={on ? 'expanded' : ''} aria-haspopup="menu" aria-expanded={on}
              onMouseEnter={expand} onClick={expand}>
              <span className="dispatch-caret" aria-hidden="true">‹</span><code>{command.skill}</code>
              <small className={`dispatch-delivery ${mode}`}>{t(deliveryText[mode])}</small>
            </button>
          </Fragment>;
        })}
      </Fragment>)}
      {expanded && <div className="dispatch-targets" role="menu" aria-label={t('dispatchTargets', { command: expanded.command.skill })}
        style={{ top: Math.max(0, expanded.top - 4) }}>
        {newPanelAgents.map(agent => <button key={agent} role="menuitem" disabled>
          <span className="dispatch-agent" aria-hidden="true">{agentIcons[agent]}</span>{t('dispatchNew', { agent: agentNames[agent] })}<small>{t('ephemeralPanel')}</small></button>)}
        {!!panels.length && <hr />}
        {panels.map(panel => <button key={panel.id} role="menuitem" onMouseEnter={() => setPointed(panel)} onClick={() => void dispatch(panel)}>
          <span className="dispatch-agent" role="img" aria-label={agentNames[panel.agent]}>{agentIcons[panel.agent]}</span>
          <ProcessingStatusIcon state={panel.status} />
          <span className="dispatch-title">{panel.run?.title ?? t('untitled')}</span>
          <small>{[panel.status && t(panel.status), t(resident(panel) ? 'residentPanel' : 'ephemeralPanel')].filter(Boolean).join(' · ')}</small>
        </button>)}
        {/* The issue URL is the forge's; the preview elides it, as the text the target receives starts the same way. */}
        {pointed && <div className="dispatch-preview"><code>{commandText(pointed.agent, expanded.command, { url: `…#${issue.number}`, number: issue.number, title: issue.title })}</code>
          <span>{t(deliveryText[delivery(expanded.workflowId, expanded.command)])}</span></div>}
      </div>}
    </div>}
  </div>;
}

/** Where an issue's latest dispatch is now: the processing state of the panel on its session and that session's title,
 * with ×N for several dispatches. Grey with its age when no panel is on the latest one's session. Clicking locates the
 * latest dispatch a panel is on now, which may be an earlier one; with none, the status is not clickable. The hint gives
 * the latest record in full: its Agent type, when, and the text sent. */
export function DispatchStatus({ records, locate }: { records: DispatchRecordView[]; locate(projectId: string, panelId: string): void }) {
  const { t, language } = useLocalization();
  const latest = records.at(-1);
  if (!latest) return null;
  const times = records.length > 1 ? <span className="dispatch-times"> ×{records.length}</span> : null;
  const record = { agent: agentNames[latest.agent], when: new Date(latest.dispatchedAt).toLocaleString(language), text: latest.text };
  const target = latestLocatable(records)?.location;
  const onClick = (event: React.MouseEvent) => { event.stopPropagation(); if (target) locate(target.projectId, target.panelId); };
  if (!latest.location) {
    const content = <>{t('dispatched')} <RelativeTime iso={latest.dispatchedAt} />{times}</>;
    return target
      ? <button className="dispatch-status gone" data-hint={t('dispatchedGoneLocatable', record)} onClick={onClick}>{content}</button>
      : <span className="dispatch-status gone" data-hint={t('dispatchedGone', record)}>{content}</span>;
  }
  const { status } = latest.location;
  const title = latest.location.title ?? t('untitled');
  const state = status ? t(status) : '';
  return <button className={`dispatch-status ${status ? `status-${status}` : ''}`} aria-label={[state, title].filter(Boolean).join(' · ')}
    data-hint={t('dispatchStatusHint', { status: state, title, ...record })} onClick={onClick}>
    <ProcessingStatusIcon state={status} /><span className="dispatch-session">{title}</span>{times}
  </button>;
}
