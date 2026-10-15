import { createPanelInteractions, type PanelInteractionContext } from '../../app/renderer/panel-interactions';
import { layoutBoxes } from '../../app/shared/layout';
import type { Layout } from '../../app/shared/model';

// The fixture is a caller: real DOM/CSS, public interaction commands and outputs.
// It does not read gesture state, measurement gates or internal callbacks.
export function createFixture() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:999;background:white';
  const canvas = document.createElement('div');
  canvas.className = 'canvas';
  canvas.style.cssText = 'position:absolute;left:20px;top:20px;width:800px;height:600px;margin:0';
  host.append(canvas); document.body.append(host);
  const panels = ['a', 'b', 'c'].map(id => ({ id, agent: 'codex' as const }));
  for (const panel of panels) {
    const slot = document.createElement('section');
    slot.className = 'panel-slot codex'; slot.dataset.panelId = panel.id;
    slot.style.transition = 'none';
    slot.innerHTML = '<div class="agent-panel"><header class="panel-header"><span class="agent-title"><span class="agent-mark">C</span><span class="session-title">Alpha</span></span><span class="panel-actions"><button>⤢</button><button>×</button></span></header><div class="terminal-container"></div></div>';
    slot.querySelector<HTMLElement>('.panel-header')!.addEventListener('pointerdown', event => interactions.startSwap(event, event.currentTarget as HTMLElement, panel.id));
    canvas.append(slot);
  }
  const initial: Layout = { axis: 'row', ratio: .3, first: { panel: 'a' }, second: { axis: 'column', ratio: .5, first: { panel: 'b' }, second: { panel: 'c' } } };
  const commits: Layout[] = [];
  let presented: Layout | null = initial;
  const presentLayout = (layout: Layout | null) => {
    presented = layout;
    const boxes = layoutBoxes(layout);
    for (const [id, box] of boxes.panels) {
      Object.assign(canvas.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!.style, {
        left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`,
      });
    }
    // Keep captured divider nodes mounted, just as keyed React elements are.
    for (const divider of boxes.dividers) {
      const key = divider.path.join('.');
      let element = canvas.querySelector<HTMLElement>(`[data-divider="${key}"]`);
      if (!element) {
        element = document.createElement('div'); element.className = 'divider'; element.dataset.divider = key;
        element.addEventListener('pointerdown', event => {
          const current = layoutBoxes(presented).dividers.find(item => item.path.join('.') === key)!;
          interactions.startResize(event, event.currentTarget as HTMLElement, current);
        });
        canvas.append(element);
      }
      const { box, ratio, axis } = divider;
      Object.assign(element.style, axis === 'row' ? {
        left: `calc(${(box.x + box.width * ratio) * 100}% - 4px)`, top: `${box.y * 100}%`, width: '8px', height: `${box.height * 100}%`,
      } : {
        left: `${box.x * 100}%`, top: `calc(${(box.y + box.height * ratio) * 100}% - 4px)`, width: `${box.width * 100}%`, height: '8px',
      });
    }
  };
  let context: PanelInteractionContext = { projectId: 'test-project', layout: initial, panels, visible: true,
    presentLayout, commitLayout: layout => { commits.push(layout); } };
  presentLayout(initial);
  const interactions = createPanelInteractions(canvas, context);
  return {
    canvas, interactions, commits,
    get presented() { return presented; },
    update(changes: Partial<PanelInteractionContext> = {}) {
      context = { ...context, ...changes }; interactions.update(context);
    },
    title(id: string, title: string) {
      canvas.querySelector<HTMLElement>(`[data-panel-id="${id}"] .session-title`)!.textContent = title;
      // Ordinary snapshots reconstruct the layout object without changing it.
      context = { ...context, layout: structuredClone(context.layout), panels: [...context.panels] };
      interactions.update(context);
    },
    dispose() { interactions.dispose(); host.remove(); },
  };
}
