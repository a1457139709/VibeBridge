import assert from 'node:assert/strict';
import test from 'node:test';
import { dropIntoLayout, layoutBoxes } from '../app/shared/layout';
import type { Layout } from '../app/shared/model';

const boxes = (layout: Layout | null) => Object.fromEntries(layoutBoxes(layout).panels);

test('splitting a side of a target panel halves it with the dropped panel on that side', () => {
  const layout: Layout = { axis: 'row', ratio: .5, first: { panel: 'a' }, second: { panel: 'b' } };
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'split', panel: 'b', side: 'right' })), {
    a: { x: 0, y: 0, width: .5, height: 1 }, b: { x: .5, y: 0, width: .25, height: 1 }, new: { x: .75, y: 0, width: .25, height: 1 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'split', panel: 'b', side: 'left' })), {
    a: { x: 0, y: 0, width: .5, height: 1 }, new: { x: .5, y: 0, width: .25, height: 1 }, b: { x: .75, y: 0, width: .25, height: 1 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'split', panel: 'a', side: 'top' })), {
    new: { x: 0, y: 0, width: .5, height: .5 }, a: { x: 0, y: .5, width: .5, height: .5 }, b: { x: .5, y: 0, width: .5, height: 1 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'split', panel: 'a', side: 'bottom' })), {
    a: { x: 0, y: 0, width: .5, height: .5 }, new: { x: 0, y: .5, width: .5, height: .5 }, b: { x: .5, y: 0, width: .5, height: 1 },
  });
});

test('swapping exchanges a rearranged panel with the target, and a panel from outside takes the target place', () => {
  const layout: Layout = { axis: 'row', ratio: .25, first: { panel: 'a' }, second: { axis: 'column', ratio: .5, first: { panel: 'b' }, second: { panel: 'c' } } };
  assert.deepEqual(boxes(dropIntoLayout(layout, 'a', { kind: 'swap', panel: 'c' })), {
    c: { x: 0, y: 0, width: .25, height: 1 }, b: { x: .25, y: 0, width: .75, height: .5 }, a: { x: .25, y: .5, width: .75, height: .5 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'swap', panel: 'b' })), {
    a: { x: 0, y: 0, width: .25, height: 1 }, new: { x: .25, y: 0, width: .75, height: .5 }, c: { x: .25, y: .5, width: .75, height: .5 },
  });
});

test('filling a side of the layout area puts the dropped panel along that whole side and the rest on the other side', () => {
  const layout: Layout = { axis: 'row', ratio: .5, first: { panel: 'a' }, second: { panel: 'b' } };
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'fill', side: 'top' })), {
    new: { x: 0, y: 0, width: 1, height: .5 }, a: { x: 0, y: .5, width: .5, height: .5 }, b: { x: .5, y: .5, width: .5, height: .5 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'fill', side: 'bottom' })), {
    a: { x: 0, y: 0, width: .5, height: .5 }, b: { x: .5, y: 0, width: .5, height: .5 }, new: { x: 0, y: .5, width: 1, height: .5 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'fill', side: 'left' })), {
    new: { x: 0, y: 0, width: .5, height: 1 }, a: { x: .5, y: 0, width: .25, height: 1 }, b: { x: .75, y: 0, width: .25, height: 1 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'new', { kind: 'fill', side: 'right' })), {
    a: { x: 0, y: 0, width: .25, height: 1 }, b: { x: .25, y: 0, width: .25, height: 1 }, new: { x: .5, y: 0, width: .5, height: 1 },
  });
});

test('a panel dropped into an empty layout occupies the whole layout area', () => {
  assert.deepEqual(boxes(dropIntoLayout(null, 'new', { kind: 'fill', side: 'left' })), { new: { x: 0, y: 0, width: 1, height: 1 } });
});

test('rearranging a resident panel removes it from its place before placing it', () => {
  const layout: Layout = { axis: 'row', ratio: .5, first: { panel: 'a' }, second: { panel: 'b' } };
  // Two panels stack top and bottom by filling a side.
  assert.deepEqual(boxes(dropIntoLayout(layout, 'b', { kind: 'fill', side: 'top' })), {
    b: { x: 0, y: 0, width: 1, height: .5 }, a: { x: 0, y: .5, width: 1, height: .5 },
  });
  assert.deepEqual(boxes(dropIntoLayout(layout, 'a', { kind: 'split', panel: 'b', side: 'bottom' })), {
    b: { x: 0, y: 0, width: 1, height: .5 }, a: { x: 0, y: .5, width: 1, height: .5 },
  });
  const three: Layout = { axis: 'column', ratio: .5, first: { panel: 'a' }, second: { axis: 'row', ratio: .5, first: { panel: 'b' }, second: { panel: 'c' } } };
  assert.deepEqual(boxes(dropIntoLayout(three, 'a', { kind: 'split', panel: 'c', side: 'right' })), {
    b: { x: 0, y: 0, width: .5, height: 1 }, c: { x: .5, y: 0, width: .25, height: 1 }, a: { x: .75, y: 0, width: .25, height: 1 },
  });
  // A panel alone in the layout fills the whole area again.
  assert.deepEqual(boxes(dropIntoLayout({ panel: 'a' }, 'a', { kind: 'fill', side: 'right' })), { a: { x: 0, y: 0, width: 1, height: 1 } });
});
