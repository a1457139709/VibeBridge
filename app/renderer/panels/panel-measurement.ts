import { terminalCellSize } from './terminals';

// Measure a bounded title in the actual UI font. Compact chrome has its own
// dimensions so measuring it never depends on the current row/stacked layout.
function panelMetrics(panel: HTMLElement) {
  const header = panel.querySelector<HTMLElement>('.panel-header')!;
  const title = header.querySelector<HTMLElement>('.session-title')!;
  const textStyle = getComputedStyle(title), heading = getComputedStyle(header), style = getComputedStyle(panel);
  const pixels = (name: string) => parseFloat(style.getPropertyValue(name));
  const sample = document.createElement('span');
  sample.style.cssText = 'position:fixed;visibility:hidden;white-space:pre';
  sample.style.font = textStyle.font; sample.style.letterSpacing = textStyle.letterSpacing;
  const letters = Array.from(title.textContent || 'Untitled task');
  sample.textContent = letters.slice(0, 12).join('') + (letters.length > 12 ? '…' : '');
  document.body.append(sample);
  const prefix = sample.getBoundingClientRect().width;
  sample.textContent = 'Untitled task';
  const textWidth = Math.max(prefix, sample.getBoundingClientRect().width);
  sample.remove();
  const borderWidth = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const borderHeight = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const mark = pixels('--compact-mark-size'), padding = pixels('--compact-padding') * 2, gap = pixels('--panel-title-gap');
  const status = header.querySelector<HTMLElement>('.processing-status');
  const statusWidth = status ? status.getBoundingClientRect().width + gap : 0;
  const line = parseFloat(textStyle.lineHeight);
  const headerHeight = pixels('--panel-header-height');
  const actions = header.querySelector<HTMLElement>('.panel-actions')!;
  return {
    // Half the bounded prefix permits two lines; icon/gap remain available even
    // when an independently shortened panel needs a single-row strip.
    minimum: { width: Math.ceil(textWidth / 2 + mark + statusWidth + gap + padding + borderWidth),
      height: Math.ceil(Math.max(mark, line) + padding + borderHeight) },
    normalWidth: textWidth + pixels('--panel-mark-size') + statusWidth + gap + pixels('--panel-header-start') + pixels('--panel-header-end')
      + actions.scrollWidth + parseFloat(heading.columnGap),
    headerHeight, borderHeight,
    rowWidth: textWidth + mark + statusWidth + gap + padding,
    rowHeight: Math.max(mark, line * 2) + padding,
    stackedHeight: mark + gap + line * 2 + padding,
  };
}

export function panelMinimumSize(panel: HTMLElement) { return panelMetrics(panel).minimum; }

export function measurePanel(container: HTMLElement, runId?: string) {
  const panel = container.closest<HTMLElement>('.agent-panel')!;
  // A hidden settings/project view has no layout, not a genuinely tiny panel.
  if (!panel.getClientRects().length) return;
  const cell = terminalCellSize(runId);
  const terminal = getComputedStyle(container);
  const metrics = panelMetrics(panel);
  // Keep measuring normal chrome even while it is removed from the tiny panel's flow.
  const normalHeight = metrics.headerHeight + cell.height * 2 + parseFloat(terminal.getPropertyValue('--normal-terminal-padding')) * 2 + metrics.borderHeight;
  const tiny = panel.clientWidth < metrics.normalWidth || panel.clientHeight < normalHeight;
  panel.dataset.tiny = String(tiny);
  if (tiny) panel.dataset.compactLayout = panel.clientHeight < metrics.rowHeight ? 'strip'
    : panel.clientWidth < metrics.rowWidth && panel.clientHeight >= metrics.stackedHeight ? 'stacked' : 'row';
  else delete panel.dataset.compactLayout;
}
