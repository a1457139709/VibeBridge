import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directoryProblemMessage,
  presentDirectoryField,
  type DirectoryCheck,
  type DirectoryCheckProblem,
} from '../app/renderer/projects/directory-field';

const resolved: DirectoryCheck = { ok: true, directory: '/real/moved', name: 'moved' };
const editing = { projectId: 'edited', directory: '/real/original' };

test('an empty directory cannot be saved and shows that it is required once touched', () => {
  const unset = { directory: null, checking: false, changed: false, canSave: false };
  assert.deepEqual(presentDirectoryField({ input: '', touched: false }), { ...unset, problem: null });
  assert.deepEqual(presentDirectoryField({ input: '', touched: true }), { ...unset, problem: { kind: 'required' } });
});

test('a directory is checking until a check of that same input settles', () => {
  const checking = { directory: null, checking: true, problem: null, changed: false, canSave: false };
  assert.deepEqual(presentDirectoryField({ input: '/typed', touched: true }), checking);
  assert.deepEqual(
    presentDirectoryField({ input: '/typed', touched: true, checked: { input: '/earlier', check: resolved } }),
    checking,
  );
});

test('each settled problem blocks saving and is shown', () => {
  const problems: DirectoryCheckProblem[] = [
    { kind: 'missing' },
    { kind: 'notDirectory' },
    { kind: 'duplicate', projectId: 'other', projectName: 'Other' },
    { kind: 'checkFailed' },
  ];
  for (const problem of problems) {
    assert.deepEqual(
      presentDirectoryField({
        input: '/typed',
        touched: false,
        checked: { input: '/typed', check: { ok: false, problem } },
      }),
      { directory: null, checking: false, problem, changed: false, canSave: false },
    );
  }
});

test('a usable directory for a new project resolves to its real path and can be saved', () => {
  assert.deepEqual(
    presentDirectoryField({ input: '/link', touched: false, checked: { input: '/link', check: resolved } }),
    {
      directory: '/real/moved',
      checking: false,
      problem: null,
      changed: false,
      canSave: true,
    },
  );
});

test("an edited project's own directory is unchanged, whether unchecked or found as its own duplicate", () => {
  const unchanged = { directory: '/real/original', checking: false, problem: null, changed: false, canSave: true };
  assert.deepEqual(presentDirectoryField({ input: '/real/original', touched: true, editing }), unchanged);
  const ownDuplicate = { kind: 'duplicate', projectId: 'edited', projectName: 'Edited' } as const;
  assert.deepEqual(
    presentDirectoryField({
      input: '/alias',
      touched: true,
      editing,
      checked: { input: '/alias', check: { ok: false, problem: ownDuplicate } },
    }),
    unchanged,
  );
});

test('an edited project moved to another usable directory is changed', () => {
  assert.deepEqual(
    presentDirectoryField({ input: '/moved', touched: true, editing, checked: { input: '/moved', check: resolved } }),
    { directory: '/real/moved', checking: false, problem: null, changed: true, canSave: true },
  );
});

test('each directory problem maps to its message for the form that shows it', () => {
  assert.deepEqual(directoryProblemMessage({ kind: 'required' }, 'create'), { id: 'directoryRequired' });
  for (const kind of ['missing', 'notDirectory', 'checkFailed'] as const)
    assert.deepEqual(directoryProblemMessage({ kind }, 'edit'), { id: 'directoryInvalid' });
  const duplicate = { kind: 'duplicate', projectId: 'other', projectName: 'Other' } as const;
  assert.deepEqual(directoryProblemMessage(duplicate, 'create'), { id: 'duplicateCreate', values: { name: 'Other' } });
  assert.deepEqual(directoryProblemMessage(duplicate, 'edit'), { id: 'duplicateEdit', values: { name: 'Other' } });
});
