import { useLocalization } from '../common/Localization';
import { agentIcons } from '../common/agent-icons';
import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type PointerEvent,
} from 'react';
import {
  panelLimitReached,
  projectPanels,
  type Layout,
  type PanelView,
  type ProjectView,
  type Run,
  type Snapshot,
} from '../../shared/model';
import { layoutBoxes } from '../../shared/layout';
import { mountTerminal } from '../panels/terminals';
import { AgentPicker } from './AgentPicker';
import { createPanelGestures, type PanelGestureContext } from '../panels/panel-interactions';
import { fitPanel } from '../panels/panel-measurement';
import { useResizeObserver } from '../common/resize-observer';
import { useWindowEvent } from '../common/window-events';
import { useDocumentEvent } from '../common/document-events';
import { requireValue } from '../common/required';
import type { ShortcutAction } from '../../shared/settings/shortcuts';
import { errorMessage } from '../../shared/caught-error';
import { useWorkspacePanelLocation, type PanelLocation } from '../panels/panel-location';
import { ProcessingStatusIcon } from '../common/ProcessingStatusIcon';
import { PanelTray } from './PanelTray';
import { growOpenedPanel, useTrayFlight } from './tray-flight';
import { ProjectSummary, type ProjectSummaryActions } from './ProjectSummary';

export interface WorkspaceActions {
  runShortcut(action: ShortcutAction): boolean;
  snapshotArrived(snapshot: Snapshot): void;
}

function TerminalView({ run }: { run?: Run }) {
  const { t } = useLocalization();
  const runningId = run?.state === 'running' ? run.id : undefined;
  const showTerminal = useCallback(
    (container: HTMLDivElement) => (runningId ? mountTerminal(runningId, container) : undefined),
    [runningId],
  );
  return (
    <div className="terminal-container" ref={showTerminal}>
      {run?.state === 'starting' ? (
        <div className="terminal-message">{t('launchPending')}</div>
      ) : run?.state === 'failed' ? (
        <div className="terminal-message">{t('launchFailed')}</div>
      ) : run?.state === 'stopped' ? (
        <div className="terminal-message">{t('runStopped')}</div>
      ) : !run ? (
        <div className="terminal-message muted">{t('starting')}</div>
      ) : null}
    </div>
  );
}

const maximizedPosition: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 };

function AgentPanel({
  panel,
  position,
  focused,
  inputTarget,
  measured,
  actions,
  select,
  focusChanged,
  headerPointerDown,
  headerClick,
  ref,
}: {
  panel: PanelView;
  position: CSSProperties;
  focused: boolean;
  inputTarget: boolean;
  measured: boolean;
  actions: ReactNode;
  select(): void;
  focusChanged(): void;
  headerPointerDown?(event: PointerEvent<HTMLElement>): void;
  headerClick(): void;
  ref?: Ref<HTMLElement>;
}) {
  const { t } = useLocalization();
  const title = panel.run?.title ?? t('untitled');
  const runId = panel.run?.id;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useResizeObserver(element, () => {
    if (element && measured) fitPanel(element, runId);
  });
  return (
    <section
      ref={ref}
      data-panel-id={panel.id}
      data-input-target={inputTarget || undefined}
      className={`panel-slot ${panel.agent}`}
      style={position}
    >
      <div
        ref={setElement}
        className={`agent-panel ${focused ? 'focused' : ''}`}
        onMouseDown={event => {
          if (!(event.target instanceof Element && event.target.closest('.panel-header'))) select();
        }}
        onFocusCapture={focusChanged}
      >
        <header
          ref={header => {
            const agentPanel = header?.parentElement;
            if (agentPanel && measured) fitPanel(agentPanel, runId);
          }}
          className="panel-header"
          onPointerDown={headerPointerDown}
          onClick={headerClick}
        >
          <span className="agent-title" data-hint={title}>
            <span className="agent-symbols">
              <ProcessingStatusIcon state={panel.status} focusable />
              <span className="agent-mark" aria-hidden="true">
                {agentIcons[panel.agent]}
              </span>
            </span>
            <span className="session-title">{title}</span>
          </span>
          <span className="panel-actions">{actions}</span>
        </header>
        <TerminalView run={panel.run} />
      </div>
    </section>
  );
}

function PanelAction({ label, perform, children }: { label: string; perform(): void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      draggable={false}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        perform();
      }}
    >
      {children}
    </button>
  );
}

export function Workspace({
  project,
  report,
  openAgentSettings,
  location,
  visible,
  ref,
}: {
  project: ProjectView;
  report(message: string): void;
  openAgentSettings(): void;
  location: PanelLocation;
  visible: boolean;
  ref: Ref<WorkspaceActions>;
}) {
  const { t, language } = useLocalization();
  const savedLayout = JSON.stringify(project.layout);
  const [shown, setShown] = useState<{ saved: string; layout: Layout | null; base?: string }>({
    saved: savedLayout,
    layout: project.layout,
  });
  let layout = shown.layout;
  if (shown.saved !== savedLayout) {
    layout = shown.base === savedLayout ? shown.layout : project.layout;
    setShown({ saved: savedLayout, layout, base: shown.base });
  }
  const [adding, setAdding] = useState(false);
  const summary = useRef<ProjectSummaryActions>(null);
  const [gestures] = useState(createPanelGestures);
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const positions = layoutBoxes(layout);
  const panelLocation = useWorkspacePanelLocation(location, project, [...positions.panels.keys()]);
  const { connectCanvas } = panelLocation;
  const attachCanvas = useCallback(
    (element: HTMLDivElement) => {
      setCanvas(element);
      return connectCanvas(element);
    },
    [connectCanvas],
  );
  const { selected: focused, maximized } = panelLocation;
  const openTrayPanel = project.tray.find(panel => panel.id === maximized);
  const atPanelLimit = panelLimitReached(project);
  const flight = useTrayFlight({ openPanelId: openTrayPanel?.id, canvas, tray, collapse: panelLocation.collapse });
  const saveLayout = (next: Layout) => {
    void window.workbench.saveLayout(project.id, next).catch(error => report(errorMessage(error)));
  };
  const placeInLayout = (panelId: string, next: Layout) => {
    const open = openTrayPanel?.id;
    panelLocation.collapse();
    void window.workbench.placeInLayout(project.id, panelId, next).catch(error => {
      if (open) panelLocation.reopen(open);
      report(errorMessage(error));
    });
  };
  const moveToTray = (panelId: string) => {
    if (maximized === panelId) panelLocation.toggleMaximize(panelId);
    void window.workbench.moveToTray(project.id, panelId).catch(error => report(errorMessage(error)));
  };
  const gestureContext = (): PanelGestureContext => ({
    canvas: requireValue(canvas, 'the layout area'),
    project,
    shownLayout: layout,
    trayElement: tray,
    language,
    visible,
    maximizedPanelId: maximized,
    present: next => setShown(previous => ({ ...previous, layout: next })),
    holdShownLayout: base => setShown(previous => ({ ...previous, base })),
    commitLayout: saveLayout,
    placeInLayout,
    moveToTray,
  });
  useWindowEvent('blur', gestures.cancel);
  useWindowEvent('resize', gestures.cancel);
  useWindowEvent('keydown', gestures.escape, { capture: true });
  useDocumentEvent('visibilitychange', () => {
    if (document.hidden) gestures.cancel();
  });
  useDocumentEvent('click', gestures.click, { capture: true });
  const close = (panelId: string) => {
    void window.workbench.closePanel(project.id, panelId).catch(error => report(errorMessage(error)));
  };
  const inputTarget = maximized ?? focused;
  const agentPanel = (
    panel: PanelView,
    position: CSSProperties,
    isFocused: boolean,
    action: ReactNode,
    { measured, ref }: { measured: boolean; ref?: Ref<HTMLElement> },
  ) => (
    <AgentPanel
      key={panel.id}
      ref={ref}
      panel={panel}
      position={position}
      focused={isFocused}
      inputTarget={panel.id === inputTarget}
      measured={measured}
      select={() => panelLocation.select(panel.id)}
      focusChanged={() => panelLocation.selectFocusedPanel(panel.id)}
      headerClick={() => panelLocation.focus(panel.id)}
      headerPointerDown={event =>
        gestures.startDrag(gestureContext(), event.nativeEvent, event.currentTarget, panel.id)
      }
      actions={
        <>
          {action}
          <PanelAction label={t('closePanel')} perform={() => close(panel.id)}>
            ×
          </PanelAction>
        </>
      }
    />
  );
  useImperativeHandle(ref, () => ({
    runShortcut(action) {
      if (adding) return false;
      if (action === 'addPanel' && !atPanelLimit) {
        setAdding(true);
        return true;
      }
      const closing = maximized ?? focused;
      if (action === 'closePanel' && closing) {
        close(closing);
        return true;
      }
      if (action === 'maximizePanel') {
        if (openTrayPanel) flight.collapseIntoCard();
        else if (focused) panelLocation.toggleMaximize(focused);
        return !!(openTrayPanel || focused);
      }
      if (action === 'nextPanel' || action === 'previousPanel') {
        if (openTrayPanel) panelLocation.collapse();
        if (focused) panelLocation.move(action === 'nextPanel' ? 1 : -1);
        return !!(openTrayPanel || focused);
      }
      return false;
    },
    snapshotArrived(snapshot) {
      gestures.snapshotArrived(snapshot.projects.find(item => item.id === project.id));
      summary.current?.membersChanged();
    },
  }));
  return (
    <div className="workspace">
      <header className="workspace-toolbar">
        {visible && (
          <ProjectSummary
            ref={summary}
            panels={projectPanels(project)}
            locate={panel => location.locatePanel(project.id, panel.id, panel.run?.id)}
          />
        )}
        <button aria-label={t('addPanel')} disabled={atPanelLimit} onClick={() => setAdding(true)}>
          ＋
        </button>
      </header>
      <div className="canvas" ref={attachCanvas} data-project-id={project.id} data-maximized-panel-id={maximized}>
        {!project.panels.length && !openTrayPanel && (
          <div className="empty">
            <p>{t('emptyProject')}</p>
            <button disabled={atPanelLimit} onClick={() => setAdding(true)}>
              ＋ {t('addPanel')}
            </button>
          </div>
        )}
        {project.panels.map(panel => {
          const box = positions.panels.get(panel.id);
          if (!box) return null;
          const position: CSSProperties =
            maximized === panel.id
              ? maximizedPosition
              : {
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  visibility: maximized ? 'hidden' : 'visible',
                };
          return agentPanel(
            panel,
            position,
            focused === panel.id,
            <>
              <PanelAction label={t('moveToTray')} perform={() => moveToTray(panel.id)}>
                ⇣
              </PanelAction>
              <PanelAction
                label={maximized === panel.id ? t('restorePanel') : t('enlargePanel')}
                perform={() => panelLocation.toggleMaximize(panel.id)}
              >
                ⤢
              </PanelAction>
            </>,
            { measured: true },
          );
        })}
        {openTrayPanel &&
          agentPanel(
            openTrayPanel,
            maximizedPosition,
            true,
            <PanelAction label={t('collapsePanel')} perform={flight.collapseIntoCard}>
              ⌄
            </PanelAction>,
            { measured: false, ref: growOpenedPanel },
          )}
        {!maximized &&
          positions.dividers.map(divider => {
            const { box, axis, ratio } = divider;
            const style: CSSProperties =
              axis === 'row'
                ? {
                    left: `calc(${(box.x + box.width * ratio) * 100}% - 4px)`,
                    top: `${box.y * 100}%`,
                    width: 8,
                    height: `${box.height * 100}%`,
                    cursor: 'col-resize',
                  }
                : {
                    left: `${box.x * 100}%`,
                    top: `calc(${(box.y + box.height * ratio) * 100}% - 4px)`,
                    height: 8,
                    width: `${box.width * 100}%`,
                    cursor: 'row-resize',
                  };
            return (
              <div
                key={divider.path.join('.')}
                role="separator"
                aria-orientation={axis === 'row' ? 'vertical' : 'horizontal'}
                className="divider"
                style={style}
                onPointerDown={event =>
                  gestures.startResize(gestureContext(), event.nativeEvent, event.currentTarget, divider)
                }
              />
            );
          })}
      </div>
      <PanelTray
        ref={setTray}
        panels={project.tray}
        openPanelId={openTrayPanel?.id}
        landedPanelId={flight.landedPanelId}
        open={panelLocation.openTrayPanel}
        collapse={flight.collapseIntoCard}
        landingEnded={flight.landingEnded}
        cardPointerDown={(event, panelId) =>
          gestures.startDrag(gestureContext(), event.nativeEvent, event.currentTarget, panelId)
        }
      />
      {adding && (
        <AgentPicker
          projectId={project.id}
          atPanelLimit={atPanelLimit}
          close={() => setAdding(false)}
          onPanelAdded={panelId => {
            setAdding(false);
            panelLocation.openAddedPanel(panelId);
          }}
          openAgentSettings={openAgentSettings}
        />
      )}
    </div>
  );
}
