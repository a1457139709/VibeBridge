import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMethodChoice } from '../app/renderer/forge/merge-requirements';
import type { MergeMethod } from '../app/shared/forge/forge';

const pullRequest = (methods: MergeMethod[], defaultMethod: MergeMethod = methods[0] ?? 'merge') => ({
  mergeOptions: { methods, defaultMethod, queue: false },
});

test('the merge offers the methods both the pull request and the forge allow, starting from the chosen one', () => {
  assert.deepEqual(
    mergeMethodChoice(pullRequest(['merge', 'squash', 'rebase']), { mergeMethods: ['rebase', 'squash'] }, 'rebase'),
    { methods: ['squash', 'rebase'], method: 'rebase', chooser: true },
  );
});

test('a chosen method the forge does not declare falls back to the first method offered', () => {
  assert.deepEqual(
    mergeMethodChoice(pullRequest(['merge', 'squash', 'rebase']), { mergeMethods: ['squash', 'rebase'] }, 'merge'),
    { methods: ['squash', 'rebase'], method: 'squash', chooser: true },
  );
});

test('with one method offered, the merge uses it without a chooser', () => {
  assert.deepEqual(mergeMethodChoice(pullRequest(['merge', 'rebase']), { mergeMethods: ['rebase'] }, 'merge'), {
    methods: ['rebase'],
    method: 'rebase',
    chooser: false,
  });
});

test('with no method offered, there is nothing to merge with and no chooser', () => {
  assert.deepEqual(mergeMethodChoice(pullRequest(['merge']), { mergeMethods: ['squash'] }, 'merge'), {
    methods: [],
    method: null,
    chooser: false,
  });
});
