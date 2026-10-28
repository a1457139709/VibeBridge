import { message } from '../app/shared/messages';
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNameError, projectNameFromDirectory } from '../app/shared/project-name';
import { arrange, assignedAgents, parseLayout, validateDraft, type ProjectDraft } from '../app/shared/model';
import { layoutBoxes } from '../app/shared/layout';
import { defaultShortcuts, shortcutConflicts, shortcutFromEvent, shortcutFormatError } from '../app/shared/shortcuts';

test('project names reject controls and clean only automatic directory names', () => {
  assert.equal(projectNameError('  '), message('nameRequired'));
  for (const control of ['\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029']) {
    assert.equal(projectNameError(`name${control}tail`), message('nameControls'));
  }
  assert.equal(projectNameError('  👩🏽‍💻 Name " $ &  '), '');
  assert.equal(projectNameFromDirectory('/projects/  👩🏽‍💻 Name\r\nnext\t\u0001\u007f  /'), '👩🏽‍💻 Name next');
  assert.equal(projectNameFromDirectory('/projects/\u0001\t '), '');
});

test('Agent allocations require integral bounded counts and exactly the project total', () => {
  const draft: ProjectDraft = { name: 'Example', directory: '/', total: 3, counts: { codex: 1, claude: 0, pi: 2 } };
  assert.doesNotThrow(() => validateDraft(draft));
  assert.deepEqual(assignedAgents(draft), ['codex', 'pi', 'pi']);
  for (const total of [0, 11, 1.5, NaN]) assert.throws(() => validateDraft({ ...draft, total }), /windowCountInvalid/);
  for (const count of [-1, 0.5, 11, NaN, 0, 2]) assert.throws(() => validateDraft({ ...draft, counts: { ...draft.counts, codex: count } }), /assignmentInvalid/);
  assert.doesNotThrow(() => validateDraft({ ...draft, total: 10, counts: { codex: 10, claude: 0, pi: 0 } }));
});

test('nested layout coordinates preserve spatial relationships and invalid saves are rejected', () => {
  const layout = { axis: 'row' as const, ratio: .25, first: { panel: 'a' }, second: {
    axis: 'column' as const, ratio: .5, first: { panel: 'b' }, second: { panel: 'c' },
  } };
  assert.deepEqual([...layoutBoxes(layout).panels], [
    ['a', { x: 0, y: 0, width: .25, height: 1 }],
    ['b', { x: .25, y: 0, width: .75, height: .5 }],
    ['c', { x: .25, y: .5, width: .75, height: .5 }],
  ]);
  const panels = ['a', 'b', 'c'].map(id => ({ id, agent: 'codex' as const }));
  assert.deepEqual(parseLayout(layout, panels), layout);
  assert.equal(parseLayout(null, []), null);
  for (const ratio of [0, 1, -.1, NaN, Infinity]) assert.throws(() => parseLayout({ ...layout, ratio }, panels), /layoutInvalid/);
  for (const invalid of ['row', { ...layout, axis: 'diagonal' }, { ...layout, first: { panel: 'a', size: 1 } }, { ...layout, weight: 1 }, undefined])
    assert.throws(() => parseLayout(invalid, panels), /layoutInvalid/);
  const deep = Array.from({ length: 11 }, () => 0).reduce<object>(node => ({ axis: 'row', ratio: .5, first: node, second: { panel: 'x' } }), { panel: 'y' });
  assert.throws(() => parseLayout(deep, panels), /layoutInvalid/);
  assert.throws(() => parseLayout({ ...layout, first: { panel: 'b' } }, panels), /layoutMismatch/);
  assert.throws(() => parseLayout(null, panels), /layoutMismatch/);
  assert.equal(arrange([]), null);
  assert.deepEqual(arrange(['a']), { panel: 'a' });
  assert.deepEqual(arrange(['a', 'b'], 'column'), { axis: 'column', ratio: .5, first: { panel: 'a' }, second: { panel: 'b' } });
  assert.deepEqual(arrange(['a', 'b', 'c']), { axis: 'column', ratio: .58, first: { panel: 'a' }, second: { axis: 'row', ratio: .5, first: { panel: 'b' }, second: { panel: 'c' } } });
});

test('shortcut recording uses physical keys, ignores composition and distinguishes conflicts from invalid formats', () => {
  const key = { code: 'BracketLeft', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, isComposing: false };
  assert.equal(shortcutFromEvent(key), 'Command+Shift+[');
  assert.equal(shortcutFromEvent({ ...key, isComposing: true }), undefined);
  assert.equal(shortcutFromEvent({ ...key, metaKey: false }), undefined);
  assert.equal(shortcutFormatError('Command+Shift+['), undefined);
  for (const binding of ['Shift+W', 'Shift+Command+W', 'Command+Command+W', 'Command+Escape', 'Command+k']) assert.ok(shortcutFormatError(binding));
  assert.deepEqual(shortcutConflicts({ ...defaultShortcuts(), previousPanel: 'Command+K', nextPanel: 'Command+K', addPanel: 'Command+C' }), [
    { binding: 'Command+K', actions: ['previousPanel', 'nextPanel'], system: undefined },
    { binding: 'Command+C', actions: ['addPanel'], system: message('copy') },
  ]);
});
