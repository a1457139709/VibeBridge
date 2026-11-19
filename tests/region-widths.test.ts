import test from 'node:test';
import assert from 'node:assert/strict';
import { draggedWidth, fitRegions } from '../app/renderer/common/region-widths';

const roomy = { navigation: 212, forgeSidebar: 380, detail: 640 };

test('regions that fit the window are drawn at their remembered widths', () => {
  assert.deepEqual(fitRegions(1400, roomy, 'navigation'), {
    navigation: { width: 212, widest: 1020 },
    forgeSidebar: { width: 380, widest: 1188 },
    detail: { width: 640, widest: 1020 },
  });
});

test("the sidebar's left edge reaches the navigation's right edge, or the window's left edge when the navigation is collapsed", () => {
  assert.equal(fitRegions(1400, roomy, 'navigation').forgeSidebar.widest, 1188);
  assert.equal(fitRegions(1400, { ...roomy, navigation: 0 }, 'navigation').forgeSidebar.widest, 1400);
});

test("the detail's left edge reaches the window's left edge, over the navigation", () => {
  assert.equal(fitRegions(1400, roomy, 'navigation').detail.widest, 1020);
  assert.equal(fitRegions(1400, { ...roomy, detail: 1020 }, 'detail').detail.width, 1020);
});

test("the navigation's right edge reaches the window's right edge, less the open sidebar", () => {
  assert.equal(fitRegions(1400, roomy, 'forgeSidebar').navigation.widest, 1020);
  assert.equal(
    fitRegions(1400, { navigation: 212, forgeSidebar: 0, detail: 0 }, 'forgeSidebar').navigation.widest,
    1400,
  );
});

test('when the regions exceed the window, the one last resized keeps its width and the others are drawn narrower', () => {
  const wide = { navigation: 600, forgeSidebar: 900, detail: 1100 };
  assert.deepEqual(fitRegions(1200, wide, 'navigation'), {
    navigation: { width: 600, widest: 600 },
    forgeSidebar: { width: 600, widest: 600 },
    detail: { width: 600, widest: 600 },
  });
  assert.deepEqual(fitRegions(1200, wide, 'forgeSidebar'), {
    navigation: { width: 300, widest: 300 },
    forgeSidebar: { width: 900, widest: 900 },
    detail: { width: 300, widest: 300 },
  });
  assert.deepEqual(fitRegions(1200, wide, 'detail'), {
    navigation: { width: 600, widest: 1100 },
    forgeSidebar: { width: 100, widest: 600 },
    detail: { width: 1100, widest: 1100 },
  });
});

test('a region wider than the whole window is drawn at the window width', () => {
  assert.deepEqual(fitRegions(800, { navigation: 212, forgeSidebar: 2000, detail: 0 }, 'forgeSidebar'), {
    navigation: { width: 0, widest: 0 },
    forgeSidebar: { width: 800, widest: 800 },
    detail: { width: 0, widest: 0 },
  });
});

test('a narrower window draws the regions narrower, and a wider one draws them at their remembered widths again', () => {
  const remembered = { navigation: 212, forgeSidebar: 700, detail: 0 };
  assert.equal(fitRegions(800, remembered, 'navigation').forgeSidebar.width, 588);
  assert.equal(fitRegions(1400, remembered, 'navigation').forgeSidebar.width, 700);
});

test('a dragged width is a whole pixel between the narrowest and the widest', () => {
  assert.equal(draggedWidth(250.6, 168, 400), 251);
  assert.equal(draggedWidth(100, 168, 400), 168);
  assert.equal(draggedWidth(900, 168, 400), 400);
});
