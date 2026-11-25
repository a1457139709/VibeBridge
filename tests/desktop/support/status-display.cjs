const assert = require('node:assert/strict');
const { localize } = require('./localization.cjs');
const { statusOf } = require('./panel-views.cjs');

module.exports = ({ evaluate, until }) => {
  const label = (run, selector) =>
    `document.querySelector('[${selector}="${run.panelId}"] .processing-status')?.getAttribute('aria-label')`;
  return async function checkStatus(run, state, language = 'en') {
    await until(
      async () => statusOf(await evaluate('window.workbench.fetchSnapshot()'), run.id) === state,
      `run ${run.id} is ${state}`,
    );
    const shown = localize(language).t(state);
    await until(
      () => evaluate(`${label(run, 'data-panel-id')} === ${JSON.stringify(shown)}`),
      `panel ${run.panelId} shows the ${state} status`,
    );
    assert.equal(await evaluate(label(run, 'data-locate-panel-id')), shown);
  };
};
