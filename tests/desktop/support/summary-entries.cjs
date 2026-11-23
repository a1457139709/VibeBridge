const { localize } = require('./localization.cjs');
const { showing } = require('./panel-views.cjs');

const summaryStates = ['ready', 'needs-input', 'done', 'error'];
const summaryEntry = state => `document.querySelector('.summary-entry:has(> .processing-${state})')`;
const entryLabel = (state, count, language = 'en') => `${count} ${localize(language).t(state)}`;
const entryLabels = (snapshot, projectId, language = 'en') =>
  summaryStates.map(state => entryLabel(state, showing(snapshot, projectId, state).length, language));
module.exports = { summaryStates, summaryEntry, entryLabel, entryLabels };
