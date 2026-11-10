import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionText, workflowCatalog } from '../app/shared/workflows';

const issue = { url: 'https://github.com/acme/widgets/issues/42', number: 42, title: 'Fix the widget' };

test("Matt's workflow lists its twelve instructions in menu order with one separator before the helpers", () => {
  const [matt] = workflowCatalog;
  assert.equal(workflowCatalog.length, 1);
  assert.equal(matt.id, 'matt');
  assert.deepEqual(matt.instructions.map(instruction => [instruction.skill, instruction.template, instruction.separatorBefore]), [
    ['grill-with-docs', '{url}', false], ['to-spec', '{url}', false], ['to-tickets', '{url}', false], ['implement', '{url}', false],
    ['implement-spec', '{url}', false], ['wayfinder', '{url}', false], ['triage', 'look at {url}', false],
    ['diagnosing-bugs', '{url}', true], ['tdd', '{url}', false], ['prototype', '{url}', false], ['research', '{url}', false], ['grill-me', '{url}', false],
  ]);
  assert.equal(new Set(matt.instructions.map(instruction => instruction.id)).size, 12);
});

test('each Agent type writes the skill invocation in its own form', () => {
  const toSpec = workflowCatalog[0].instructions.find(instruction => instruction.skill === 'to-spec')!;
  assert.equal(instructionText('claude', toSpec, issue), '/to-spec https://github.com/acme/widgets/issues/42');
  assert.equal(instructionText('codex', toSpec, issue), '$to-spec https://github.com/acme/widgets/issues/42');
  assert.equal(instructionText('pi', toSpec, issue), '/skill:to-spec https://github.com/acme/widgets/issues/42');
});

test('templates fill only the url, number and title placeholders', () => {
  const instruction = { id: 'custom', skill: 'triage', template: '{title} #{number} at {url} {body} {url}', separatorBefore: false };
  assert.equal(instructionText('claude', instruction, issue),
    '/triage Fix the widget #42 at https://github.com/acme/widgets/issues/42 {body} https://github.com/acme/widgets/issues/42');
});
