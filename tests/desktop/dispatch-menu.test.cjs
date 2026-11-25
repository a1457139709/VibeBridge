const assert = require('node:assert/strict');

const drawnWhole = selector => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const box = element.getBoundingClientRect(), inset = 10;
  return [[box.left + inset, box.top + inset], [box.right - inset, box.top + inset], [box.left + inset, box.bottom - inset], [box.right - inset, box.bottom - inset]]
    .every(([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && element.contains(document.elementFromPoint(x, y)));
})()`;
const highlighted = `[...document.querySelectorAll('.dispatch-targets [role=menuitem]')]
  .flatMap((item, index) => getComputedStyle(item).backgroundColor === 'rgba(0, 0, 0, 0)' ? []
    : [[index, [...item.querySelector('.agent-mark').classList].find(name => name !== 'agent-mark')]])`;
const { t } = require('./support/localization.cjs');

module.exports = {
  async run(context) {
    await require('./support/gh-double.cjs')(context.directory, {
      account: 'octo',
      repositories: ['octo/desktop'],
      issues: [
        {
          number: 7,
          title: 'Dispatched issue',
          state: 'OPEN',
          createdAt: new Date().toISOString(),
          labels: [],
          bodyHTML: '<p>Body</p>',
        },
      ],
    });
    const snapshot = await require('./support/project.cjs')(context, 'Dispatch menu project', { Codex: 1 });
    const { window, evaluate, until, click } = context;
    const { rect, center } = require('./support/dragging.cjs')(context);
    const project = snapshot.projects[0];
    await evaluate(`(async () => window.workbench.bindRepository(${JSON.stringify(project.id)},
      (await window.workbench.fetchRepositoryChoices(${JSON.stringify(project.id)}, ${JSON.stringify(project.directory)}))
        .repositories.find(item => item.path === 'octo/desktop')))()`);
    await click(t('openForgeSidebar', { forge: project.forge.name }));
    await until(() => evaluate('!!document.querySelector(\'.forge-scroll [data-issue="7"]\')'), 'issue #7 row listed');
    const point = async selector => {
      const target = center(await rect(selector));
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await until(
        () =>
          evaluate(`(() => { const corner = document.elementFromPoint(1, 1);
        return !!corner && corner.matches(':hover') && !corner.contains(document.querySelector(${JSON.stringify(selector)})); })()`),
        'pointer in the corner',
      );
      window.webContents.sendInputEvent({ type: 'mouseMove', ...target });
    };
    const key = keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    };

    for (const [place, scope] of [
      ['row', '.forge-scroll'],
      ['detail', '.forge-detail'],
    ]) {
      if (place === 'detail') {
        await evaluate('document.querySelector(\'.forge-scroll [data-issue="7"] .forge-row-title\').click()');
        await until(
          () => evaluate('!!document.querySelector(".forge-detail .dispatch-button")'),
          'issue detail open with its Dispatch',
        );
      }
      for (const height of [null, 480]) {
        if (height) {
          window.setContentSize(1280, height);
          await until(
            () => evaluate(`document.documentElement.clientHeight === ${height}`),
            `window content is ${height}px high`,
          );
        } else {
          window.setContentSize(1280, 700);
          await until(() => evaluate('document.documentElement.clientWidth === 1280'), 'window content is 1280px wide');
        }
        await evaluate(`document.querySelector('${scope} .dispatch-button').click()`);
        await until(
          () => evaluate('document.activeElement?.classList.contains("dispatch-menu")'),
          `dispatch menu open from the ${place}`,
        );
        await point('.dispatch-menu > [role=menuitem]:last-of-type');
        await until(
          () => evaluate('!!document.querySelector(".dispatch-targets")'),
          'targets of the last command shown',
        );
        await until(
          () => evaluate(drawnWhole('.dispatch-menu')),
          `commands drawn whole from the ${place} in a ${height ? `${height}px` : 'tall'} window`,
        );
        await until(
          () => evaluate(drawnWhole('.dispatch-targets')),
          `targets drawn whole from the ${place} in a ${height ? `${height}px` : 'tall'} window`,
        );
        key('Escape');
        await until(() => evaluate('!document.querySelector(".dispatch-menu")'), 'dispatch menu closed');
      }
    }

    await evaluate('document.querySelector(".forge-detail .dispatch-button").click()');
    await until(() => evaluate('document.activeElement?.classList.contains("dispatch-menu")'), 'dispatch menu open');
    await point('.dispatch-menu > [role=menuitem]:last-of-type');
    await until(() => evaluate('!!document.querySelector(".dispatch-targets")'), 'targets shown');
    await point('.dispatch-targets [role=menuitem]:nth-of-type(2)');
    await until(
      () =>
        evaluate(
          'document.querySelector(".dispatch-targets [role=menuitem]:nth-of-type(2)").classList.contains("cursor")',
        ),
      'pointed target has the cursor',
    );
    key('Down');
    await until(
      () =>
        evaluate(
          'document.querySelector(".dispatch-targets [role=menuitem]:nth-of-type(3)").classList.contains("cursor")',
        ),
      'cursor moved down by key',
    );
    await until(
      async () => JSON.stringify(await evaluate(highlighted)) === JSON.stringify([[2, 'pi']]),
      "only the cursor's target, a new pi panel, highlighted",
    );

    const colors = await evaluate(`[...document.querySelectorAll('.dispatch-targets [role=menuitem]')].slice(0, 3)
      .map(item => getComputedStyle(item.querySelector('.agent-mark')).color)`);
    const panelColor = await evaluate(
      'getComputedStyle(document.querySelector(".canvas .agent-title .agent-mark")).color',
    );
    assert.equal(new Set(colors).size, 3, `the three Agent types have their own colors: ${colors}`);
    assert.equal(colors[1], panelColor, "the new Codex target has the Codex panel's type color");
    console.log(
      "The dispatch menu drew whole from the row and the detail, highlighted only its cursor, and kept each Agent type's color.",
    );
  },
};
