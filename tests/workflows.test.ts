import test from 'node:test';
import assert from 'node:assert/strict';
import { commandText, workflows } from '../app/shared/workflows';

const issue = { url: 'https://github.com/acme/app/issues/7', number: 7, title: 'Fix the {url} parser' };
const command = (id: string) => workflows[0].commands.find(command => command.id === id)!;

test('a command is written in the skill call syntax of each Agent type', () => {
  assert.equal(commandText('claude', command('to-spec'), issue), '/to-spec https://github.com/acme/app/issues/7');
  assert.equal(commandText('codex', command('to-spec'), issue), '$to-spec https://github.com/acme/app/issues/7');
  assert.equal(commandText('pi', command('triage'), issue), '/skill:triage look at https://github.com/acme/app/issues/7');
});

test('an argument template fills only url, number and title, and leaves other braces as written', () => {
  const template = { id: 'custom', skill: 'custom', args: '{number} {title} {body} {url}' };
  assert.equal(commandText('claude', template, issue), '/custom 7 Fix the {url} parser {body} https://github.com/acme/app/issues/7');
});
