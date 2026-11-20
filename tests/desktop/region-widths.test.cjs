const assert = require('node:assert/strict');

const rect = (evaluate, selector) =>
  evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return box && { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }; })()`);

// The project navigation, the forge sidebar and the issue detail are as wide as the user drags them: each edge
// reaches its farthest place and no farther than the window, and a window too narrow for them draws them narrower
// without changing the widths they return to.
module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, {
      account: 'octo',
      repositories: ['octo/desktop'],
      issues: [
        {
          number: 7,
          title: 'Wide issue',
          state: 'OPEN',
          createdAt: new Date().toISOString(),
          labels: [],
          bodyHTML: '<p>A long body</p>',
        },
      ],
    });
    const snapshot = await require('./support/project.cjs')(base, 'Widths project', { Codex: 1 });
    const { window, evaluate, until, click } = base;
    const project = snapshot.projects[0];
    await evaluate(`(async () => window.workbench.bindRepository(${JSON.stringify(project.id)},
      (await window.workbench.repositoryChoices(${JSON.stringify(project.id)}, ${JSON.stringify(project.directory)}))
        .repositories.find(item => item.path === 'octo/desktop')))()`);
    const remembered = () =>
      evaluate('window.workbench.snapshot().then(({ navigation, forgeSidebar }) => ({ navigation, forgeSidebar }))');
    const center = box => ({ x: Math.round(box.left + box.width / 2), y: 300 });
    // Drags the edge to x, which may lie beyond where the edge can go.
    const drag = async (selector, x) => {
      const from = center(await rect(evaluate, selector));
      const held = { button: 'left', modifiers: ['leftbuttondown'] };
      window.webContents.sendInputEvent({ type: 'mouseDown', ...from, ...held, clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x, y: from.y, ...held });
      window.webContents.sendInputEvent({ type: 'mouseUp', x, y: from.y, button: 'left', clickCount: 1 });
    };
    const resizeWindow = async width => {
      window.setContentSize(width, 800);
      await until(
        () => evaluate(`document.documentElement.clientWidth === ${width}`),
        `window content is ${width}px wide`,
      );
    };

    await resizeWindow(1280);
    await click('Show the GitHub sidebar');
    await until(async () => (await rect(evaluate, '.forge-sidebar'))?.width === 380, 'sidebar drawn 380px wide');

    // The navigation's right edge reaches the sidebar's left edge, and no farther.
    await drag('.navigation-resize', 1279);
    await until(
      async () => (await remembered()).navigation.width === 900,
      'dragging the navigation past the sidebar saved the width that ends it at the sidebar',
    );
    await until(
      async () => (await rect(evaluate, '.navigation')).right === (await rect(evaluate, '.forge-sidebar')).left,
      'the navigation drawn up to the sidebar',
    );
    assert.ok((await rect(evaluate, '.forge-sidebar')).right <= 1280, 'the sidebar stays in the window');
    await evaluate(`window.workbench.saveSidebar('navigation', { visible: true, width: 212 })`);
    await until(async () => (await rect(evaluate, '.navigation')).width === 212, 'navigation drawn 212px wide again');

    // The sidebar's left edge reaches the navigation's right edge, and no farther.
    await drag('.forge-sidebar-resize', 0);
    await until(
      async () => (await remembered()).forgeSidebar.width === 1068,
      'dragging the sidebar past the navigation saved the width that ends it at the navigation',
    );
    await until(
      async () => (await rect(evaluate, '.forge-sidebar')).left === 212,
      'the sidebar drawn over the whole layout area, up to the navigation',
    );

    // A narrower window draws the last-dragged sidebar at its width and the navigation narrower; neither width changes.
    await resizeWindow(1000);
    await until(async () => {
      const sidebar = await rect(evaluate, '.forge-sidebar');
      return sidebar.left >= 0 && sidebar.left <= 1 && sidebar.right === 1000;
    }, 'the sidebar drawn within the narrower window');
    assert.deepEqual(await remembered(), {
      navigation: { visible: true, width: 212 },
      forgeSidebar: { visible: true, width: 1068 },
    });
    await resizeWindow(1280);
    await until(async () => {
      const [navigation, sidebar] = [await rect(evaluate, '.navigation'), await rect(evaluate, '.forge-sidebar')];
      return navigation.width === 212 && sidebar.width === 1068;
    }, 'a wider window draws both at their remembered widths again');

    // The detail's left edge reaches the window's left edge, over the navigation, and no farther.
    await evaluate(`window.workbench.saveSidebar('forgeSidebar', { visible: true, width: 380 })`);
    await until(async () => (await rect(evaluate, '.forge-sidebar')).width === 380, 'sidebar drawn 380px wide again');
    await click('Wide issue');
    await until(
      () => evaluate('document.querySelector(".forge-detail h2")?.textContent === "Wide issue #7"'),
      'issue detail drawn',
    );
    await drag('.forge-detail-resize', 0);
    await until(async () => {
      const detail = await rect(evaluate, '.forge-detail');
      return detail.left === 0 && detail.right === 900;
    }, 'the detail drawn from the window edge to the sidebar, over the navigation');
    console.log(
      'Each edge reached its farthest place within the window; a narrower window drew the regions narrower and a wider one restored them.',
    );
  },
};
