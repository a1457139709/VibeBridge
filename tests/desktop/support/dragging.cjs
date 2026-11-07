// Native pointer drags in the workbench window, and the geometry they are checked against.
module.exports = ({ window, evaluate, until }) => {
  const rect = selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`);
  const center = box => ({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) });
  return {
    rect, center,
    // Panel slot geometry relative to the layout area, rounded to 1/100.
    geometry: ids => evaluate(`(() => {
      const canvas = document.querySelector('.canvas').getBoundingClientRect();
      return Object.fromEntries(${JSON.stringify(ids)}.map(id => {
        const box = document.querySelector('.canvas > [data-panel-id="' + id + '"]').getBoundingClientRect();
        return [id, [(box.x - canvas.x) / canvas.width, (box.y - canvas.y) / canvas.height, box.width / canvas.width, box.height / canvas.height]
          .map(value => Math.round(value * 100) / 100)];
      }));
    })()`),
    // Presses on the element and moves past the drag threshold. Electron's button identifies the changed
    // button; modifiers carry the held button across movement.
    async press(selector) {
      const start = center(await rect(selector));
      window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', modifiers: ['leftbuttondown'], clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + 10, y: start.y + 10, button: 'left', modifiers: ['leftbuttondown'] });
      await until(() => evaluate('document.querySelector(".canvas").classList.contains("dragging")'));
    },
    async hover(point, preview) {
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left', modifiers: ['leftbuttondown'] });
      await until(() => evaluate(`document.querySelector('[role="img"][aria-label=${JSON.stringify(preview)}]') !== null`));
    },
    release: point => window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }),
    // The drop preview outline relative to the layout area, rounded to 1/100.
    async previewBox() {
      const canvas = await rect('.canvas'), box = await rect('.panel-drop-preview');
      return [box.left - canvas.left, box.top - canvas.top, box.width, box.height].map((value, index) => Math.round(value / (index % 2 ? canvas.height : canvas.width) * 100) / 100);
    },
  };
};
