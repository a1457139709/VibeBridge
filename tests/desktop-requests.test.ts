import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopRequestArguments } from '../app/main/desktop-requests';
import { defaultSettings } from '../app/shared/settings/settings';

test('settings whose values a save rejects still reach the save, which reports each field', () => {
  const { agents, shortcuts } = defaultSettings();
  const patch = {
    agents: { ...agents, codex: { command: ' ', args: [] } },
    shortcuts: { ...shortcuts, settings: 'Q' },
  };
  assert.deepEqual(desktopRequestArguments.saveSettings.parse([patch]), [patch]);
});

test('settings keys outside the current settings pass through, as reading settings keeps them', () => {
  const { workflows } = defaultSettings();
  const patch = { workflows: { ...workflows, retired: { enabled: true, commands: {} } }, sound: 'on' };
  assert.deepEqual(desktopRequestArguments.saveSettings.parse([patch]), [patch]);
});

for (const [request, args] of [
  ['saveSettings', [{ agents: { codex: { command: 'codex', args: [] } } }]],
  ['saveSettings', [{ language: 'fr' }]],
  ['createProject', [{ name: 'Tools', directory: '/tools', total: 1, counts: { codex: 1 } }]],
  ['saveSidebar', ['toolbar', { visible: true, width: 240 }]],
  ['placeInLayout', ['project-a', 'panel-a', null]],
  ['resizeRun', ['run-a', '80', 24]],
  ['sendInput', ['run-a']],
  ['deleteProject', ['project-a', 'project-b']],
] as const) {
  test(`${request} arguments that are not the ones the contract gives it are refused: ${JSON.stringify(args)}`, () => {
    assert.equal(desktopRequestArguments[request].safeParse(args).success, false);
  });
}

test('arguments the contract gives a request are read as sent', () => {
  const layout = { axis: 'row', ratio: 0.5, first: { panel: 'panel-a' }, second: { panel: 'panel-b' } };
  assert.deepEqual(desktopRequestArguments.placeInLayout.parse(['project-a', 'panel-a', layout]), [
    'project-a',
    'panel-a',
    layout,
  ]);
  assert.deepEqual(desktopRequestArguments.saveSidebar.parse(['forgeSidebar', { visible: false, width: 380 }]), [
    'forgeSidebar',
    { visible: false, width: 380 },
  ]);
});
