module.exports = ({ window, evaluate, until }) => {
  const rect = selector =>
    evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  })()`);
  const center = box => ({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) });
  return {
    rect,
    center,
    geometry: ids =>
      evaluate(`(() => {
      const canvas = document.querySelector('.canvas').getBoundingClientRect();
      const slots = ${JSON.stringify(ids)}.map(id => [id, document.querySelector('.canvas > [data-panel-id="' + id + '"]')]);
      if (slots.some(([, slot]) => !slot)) return null;
      return Object.fromEntries(slots.map(([id, slot]) => {
        const box = slot.getBoundingClientRect();
        return [id, [(box.x - canvas.x) / canvas.width, (box.y - canvas.y) / canvas.height, box.width / canvas.width, box.height / canvas.height]
          .map(value => Math.round(value * 100) / 100)];
      }));
    })()`),
    async press(selector) {
      const start = center(await rect(selector));
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...start,
        button: 'left',
        modifiers: ['leftbuttondown'],
        clickCount: 1,
      });
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: start.x + 10,
        y: start.y + 10,
        button: 'left',
        modifiers: ['leftbuttondown'],
      });
      await until(
        () => evaluate('document.querySelector(".canvas").classList.contains("dragging")'),
        'layout area enters dragging after the press',
      );
    },
    async hover(point, preview) {
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left', modifiers: ['leftbuttondown'] });
      await until(
        () => evaluate(`document.querySelector('[role="img"][aria-label=${JSON.stringify(preview)}]') !== null`),
        `drop preview "${preview}" drawn`,
      );
    },
    release: point => window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }),
    async previewBox() {
      const canvas = await rect('.canvas'),
        box = await rect('.panel-drop-preview');
      return [box.left - canvas.left, box.top - canvas.top, box.width, box.height].map(
        (value, index) => Math.round((value / (index % 2 ? canvas.height : canvas.width)) * 100) / 100,
      );
    },
  };
};
