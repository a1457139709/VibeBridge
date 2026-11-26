import { useLocalization } from '../common/Localization';
import { useId, useRef, useState } from 'react';
import { agentNames, type PanelView } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';
import { agentIcons } from '../common/agent-icons';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { useElementMeasurement } from '../common/effects/element-measurement';
import { useEventListener } from '../common/effects/event-listener';
import { useFocusRequestBeforePaint } from '../common/effects/focus-request';

const summaryStates = ['ready', 'needs-input', 'done', 'error'] as const satisfies readonly ProcessingState[];
type SummaryState = (typeof summaryStates)[number];

export function ProjectSummary({ panels, locate }: { panels: PanelView[]; locate(panel: PanelView): void }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState<SummaryState>();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<SummaryState, HTMLButtonElement>());
  const [focusedMember, setFocusedMember] = useState<string>();
  const requestFocus = useFocusRequestBeforePaint();
  const members = (state: SummaryState) => panels.filter(panel => panel.status === state);
  const firstMember = () => list.current?.querySelector<HTMLButtonElement>('li button');
  if (open && focusedMember && !members(open).some(panel => panel.run?.id === focusedMember)) {
    setFocusedMember(undefined);
    requestFocus(() =>
      document.activeElement === document.body
        ? (firstMember() ?? list.current?.querySelector<HTMLButtonElement>('header button'))
        : undefined,
    );
  }
  function show(state: SummaryState | undefined, fromEnd = false) {
    setOpen(state);
    setFocusedMember(undefined);
    if (state)
      requestFocus(() => {
        const choices = list.current?.querySelectorAll<HTMLButtonElement>('li button');
        return choices?.[fromEnd ? choices.length - 1 : 0];
      });
  }
  function close(restoreFocus = false) {
    show(undefined);
    if (restoreFocus && open) {
      const trigger = triggers.current.get(open);
      if (trigger && !trigger.disabled) trigger.focus();
      else container.current?.focus();
    }
  }
  function position() {
    const summary = container.current,
      popup = list.current;
    if (!summary || !popup) return;
    const box = summary.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(box.left + (box.width - popup.offsetWidth) / 2, window.innerWidth - popup.offsetWidth - 8),
    );
    popup.style.left = `${left - box.left}px`;
  }
  useElementMeasurement(position);
  useEventListener(open ? window : undefined, 'resize', position);
  useEventListener(open ? document : undefined, 'pointerdown', event => {
    const target = event.target instanceof Node ? event.target : null;
    if (!list.current?.contains(target) && ![...triggers.current.values()].some(button => button.contains(target)))
      close();
  });
  useEventListener(open ? document : undefined, 'keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  return (
    <div ref={container} className="project-summary" role="region" aria-label={t('projectSummary')} tabIndex={-1}>
      {summaryStates.map(state => {
        const count = members(state).length;
        const label = t('summaryEntry', { count, state: t(state) });
        return (
          <button
            key={state}
            className="summary-entry"
            aria-label={label}
            data-hint={label}
            ref={button => {
              if (button) triggers.current.set(state, button);
              else triggers.current.delete(state);
            }}
            disabled={!count}
            aria-expanded={open === state}
            aria-controls={open === state ? id : undefined}
            aria-haspopup="dialog"
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                show(state, event.key === 'ArrowUp');
              }
            }}
            onClick={() => show(open === state ? undefined : state)}
          >
            <ProcessingStatusIcon state={state} />
            <span>
              {count}
              <span className="summary-name"> {t(state)}</span>
            </span>
          </button>
        );
      })}
      {open && (
        <section
          ref={list}
          id={id}
          className="summary-list"
          role="dialog"
          aria-label={t(open)}
          onFocusCapture={event => {
            setFocusedMember(event.target instanceof Element ? event.target.closest('li')?.dataset.runId : undefined);
          }}
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const members = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('li button')];
            if (!members.length) return;
            const index = members.findIndex(member => member === document.activeElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? members.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + members.length) % members.length;
            event.preventDefault();
            members[next].focus();
            members[next].scrollIntoView({ block: 'nearest' });
          }}
        >
          <header>
            <strong>{t(open)}</strong>
            <button aria-label={t('closePanelList')} onClick={() => close(true)}>
              ×
            </button>
          </header>
          <ul>
            {members(open).map(panel => {
              const title = panel.run?.title ?? t('untitled');
              return (
                <li key={panel.run?.id} data-run-id={panel.run?.id}>
                  <button
                    className={`summary-panel ${panel.agent}`}
                    data-hint={t('agentPanelTitle', { agent: agentNames[panel.agent], title })}
                    onClick={() => {
                      show(undefined);
                      locate(panel);
                    }}
                  >
                    <span className="agent-mark" aria-hidden="true">
                      {agentIcons[panel.agent]}
                    </span>
                    <span className="session-title">{title}</span>
                    <small>{agentNames[panel.agent]}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          {!members(open).length && <p className="muted">{t('noMatchingPanels')}</p>}
        </section>
      )}
    </div>
  );
}
