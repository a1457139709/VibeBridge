import { useLocalization } from './Localization';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { agentNames, type Snapshot } from '../shared/model';
import { summaryStates, type SummaryState } from '../shared/processing-status';
import { sessionTitle } from '../shared/session-title';
import { agentIcons } from './agent-icons';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import type { PanelLocation } from './panel-location';


export function ProjectSummary({ snapshot, locatePanel }: { snapshot?: Snapshot; locatePanel: PanelLocation['locatePanel'] }) {
  const { t } = useLocalization();
  const project = snapshot?.projects.find(item => item.id === snapshot.activeProjectId);
  return <footer className="project-summary" role="region" aria-label={t('projectSummary')}>
    {project && snapshot && <SummaryEntries key={project.id} snapshot={snapshot} projectId={project.id} locatePanel={locatePanel} />}
  </footer>;
}

function SummaryEntries({ snapshot, projectId, locatePanel }: { snapshot: Snapshot; projectId: string; locatePanel: PanelLocation['locatePanel'] }) {
  const { t, language } = useLocalization();
  const [open, setOpen] = useState<SummaryState>();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<SummaryState, HTMLButtonElement>());
  const fromEnd = useRef(false);
  const focusedMember = useRef<string | undefined>(undefined);
  const groups = snapshot.processing.projects[projectId];
  const project = snapshot.projects.find(item => item.id === projectId)!;
  function close(restoreFocus = false) {
    setOpen(undefined);
    if (restoreFocus && open) {
      const trigger = triggers.current.get(open);
      if (trigger && !trigger.disabled) trigger.focus(); else container.current?.focus();
    }
  }
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggers.current.get(open), popup = list.current;
      if (trigger && popup) popup.style.left = `${Math.max(8, Math.min(trigger.getBoundingClientRect().left, window.innerWidth - popup.offsetWidth - 8))}px`;
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open, language]);
  useLayoutEffect(() => {
    if (!open) return;
    const members = list.current?.querySelectorAll<HTMLButtonElement>('li button');
    members?.[fromEnd.current ? members.length - 1 : 0]?.focus();
    fromEnd.current = false;
  }, [open]);
  useLayoutEffect(() => {
    if (open && focusedMember.current && !groups[open].members.some(member => member.runId === focusedMember.current)
      && document.activeElement === document.body) {
      (list.current?.querySelector<HTMLButtonElement>('li button') ?? list.current?.querySelector<HTMLButtonElement>('header button'))?.focus();
    }
  }, [snapshot, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && ![...triggers.current.values()].some(button => button.contains(target))) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={container} className="summary-entries" tabIndex={-1}>{summaryStates.map(state => {
    const label = `${groups[state].count} ${t(state)}`;
    return <button key={state} className="summary-entry" aria-label={label} title={label}
    ref={button => { if (button) triggers.current.set(state, button); else triggers.current.delete(state); }}
    disabled={!groups[state].count} aria-expanded={open === state} aria-controls={open === state ? id : undefined} aria-haspopup="dialog"
    onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); fromEnd.current = event.key === 'ArrowUp'; setOpen(state); }
    }}
    onClick={() => setOpen(previous => previous === state ? undefined : state)}>
    <ProcessingStatusIcon state={state} /><span>{groups[state].count}<span className="summary-name"> {t(state)}</span></span>
  </button>;
  })}
    {open && <section ref={list} id={id} className="summary-list" role="dialog" aria-label={t(open)}
      onFocusCapture={event => { focusedMember.current = (event.target as HTMLElement).closest('li')?.dataset.runId; }} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const members = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('li button')];
      if (!members.length) return;
      const index = members.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? members.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + members.length) % members.length;
      event.preventDefault(); members[next].focus(); members[next].scrollIntoView({ block: 'nearest' });
    }}>
      <header><strong>{t(open)}</strong><button aria-label={t('closePanelList')} onClick={() => close(true)}>×</button></header>
      <ul>{groups[open].members.map(member => {
        const panel = project.panels.find(item => item.id === member.panelId)!;
        const run = snapshot.runs.find(item => item.id === member.runId);
        const title = sessionTitle(panel.agent, run?.rawTitle, t('untitled'));
        return <li key={member.runId} data-run-id={member.runId}><button className={`summary-panel ${panel.agent}`} title={`${agentNames[panel.agent]} · ${title}`}
          onClick={() => { setOpen(undefined); locatePanel(projectId, member.panelId, member.runId); }}>
          <span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span><span className="session-title">{title}</span><small>{agentNames[panel.agent]}</small>
        </button></li>;
      })}</ul>
      {!groups[open].count && <p className="muted">{t('noMatchingPanels')}</p>}
    </section>}
  </div>;
}
