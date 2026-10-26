import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Payload } from '../app/main/agent-status/adapter';
import { claude } from '../app/main/agent-status/claude/status';
import { observe } from './support/interpreter';

/** A Claude run whose session has started, fed facts as its Status Reporter sends them. */
function started() {
  const accept = observe(claude, { session_id: 'session' });
  accept({ hook_event_name: 'SessionStart', source: 'startup' });
  return (payload: Payload, expected: string) => assert.equal(accept(payload), expected, JSON.stringify(payload));
}

test('Claude separates blocking input and individual tool failure from a failed main turn', () => {
  const check = started();
  check({ hook_event_name: 'SessionStart' }, 'ready');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' }, 'busy');
  check({ hook_event_name: 'Elicitation' }, 'needs-input');
  check({ hook_event_name: 'ElicitationResult' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval' }, 'needs-input');
  check({ hook_event_name: 'PostToolUseFailure', tool_use_id: 'approval' }, 'busy');
  check({ hook_event_name: 'PreCompact' }, 'busy');
  check({ hook_event_name: 'SubagentStop' }, 'busy');
  check({ hook_event_name: 'StopFailure' }, 'error');
  check({ hook_event_name: 'Notification' }, 'error');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'Stop' }, 'done');
});

test('Claude waits survive unrelated tools and resolve only with matching results or a new main-turn fact', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' }, 'needs-input');
  check({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'read' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'read' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'approved', tool_input_hash: 'approved-input' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input_hash: 'approved-input' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'other', tool_input_hash: 'other-input' }, 'needs-input');
  check({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'approved', tool_input_hash: 'approved-input' }, 'busy');
  check({ hook_event_name: 'Elicitation', mcp_server_name: 'forms', elicitation_id: 'one' }, 'needs-input');
  check({ hook_event_name: 'Elicitation', mcp_server_name: 'forms', elicitation_id: 'two' }, 'needs-input');
  check({ hook_event_name: 'ElicitationResult', mcp_server_name: 'forms', elicitation_id: 'one' }, 'needs-input');
  check({ hook_event_name: 'PreCompact' }, 'needs-input');
  check({ hook_event_name: 'ElicitationResult', mcp_server_name: 'forms', elicitation_id: 'two' }, 'busy');
  check({ hook_event_name: 'PostCompact' }, 'busy');
  check({ hook_event_name: 'SessionStart', source: 'compact' }, 'busy');
  check({ hook_event_name: 'PostToolUseFailure', tool_use_id: 'failed' }, 'busy');
  check({ hook_event_name: 'StopFailure' }, 'error');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PermissionRequest' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'unrelated' }, 'needs-input');
  check({ hook_event_name: 'Stop' }, 'done');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'Stop' }, 'done');
});

test('indistinguishable concurrent Claude permission requests stay waiting until a main-turn fact resolves them', () => {
  const check = started();
  const tool = { tool_name: 'Bash', tool_input_hash: 'pwd' };
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'one', ...tool }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'two', ...tool }, 'busy');
  check({ hook_event_name: 'PermissionRequest', ...tool }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'one', ...tool }, 'needs-input');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
});

test('an Error discards tools in progress, so a later permission request matches only tools started after it', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'before', tool_input_hash: 'same' }, 'busy');
  check({ hook_event_name: 'Unclassified' }, 'error');
  check({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'after', tool_input_hash: 'same' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input_hash: 'same' }, 'needs-input');
  // The result of a tool from before the Error cannot answer the new request.
  check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'before', tool_input_hash: 'same' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'after', tool_input_hash: 'same' }, 'busy');
});

test('replayed Claude prompt and elicitation identities cannot reopen completed work', () => {
  const check = started();
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt_id: 'prompt' };
  check(prompt, 'busy');
  check({ hook_event_name: 'Stop', prompt_id: 'prompt' }, 'done');
  check(prompt, 'done');
  const elicitation = { mcp_server_name: 'forms', elicitation_id: 'request', prompt_id: 'next' };
  check({ hook_event_name: 'UserPromptSubmit', prompt_id: 'next' }, 'busy');
  check({ hook_event_name: 'Elicitation', ...elicitation }, 'needs-input');
  check({ hook_event_name: 'ElicitationResult', ...elicitation }, 'busy');
  check({ hook_event_name: 'Elicitation', ...elicitation }, 'busy');
  check({ hook_event_name: 'Stop', prompt_id: 'next' }, 'done');
  check({ hook_event_name: 'ElicitationResult', ...elicitation }, 'done');
});

test('Claude child activity and identifiable old session, prompt and tool events cannot change the main run', () => {
  const check = started();
  check({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'current' }, 'ready');
  check({ hook_event_name: 'UserPromptSubmit', session_id: 'current', prompt_id: 'old' }, 'busy');
  check({ hook_event_name: 'UserPromptSubmit', session_id: 'current', prompt_id: 'new' }, 'busy');
  check({ hook_event_name: 'Stop', session_id: 'current', agent_id: 'child' }, 'busy');
  check({ hook_event_name: 'StopFailure', session_id: 'current', agent_id: 'child' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', agent_id: 'child', session_id: 'current' }, 'busy');
  check({ hook_event_name: 'SubagentStop', session_id: 'current' }, 'busy');
  check({ hook_event_name: 'Stop', session_id: 'current', prompt_id: 'old' }, 'busy');
  check({ hook_event_name: 'PostToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' }, 'busy');
  check({ hook_event_name: 'Stop', session_id: 'current', prompt_id: 'new' }, 'done');
  check({ hook_event_name: 'PostToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' }, 'done');
  check({ hook_event_name: 'PreToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' }, 'done');
  check({ hook_event_name: 'SessionStart', session_id: 'fresh', source: 'clear' }, 'ready');
  check({ hook_event_name: 'Stop', session_id: 'current' }, 'ready');
  check({ hook_event_name: 'SessionStart', session_id: 'current', source: 'startup' }, 'ready');
});

test('Claude launch preparation keeps invocation settings, existing hooks and files, including relative paths', async () => {
  const directory = await mkdtemp(resolve("work/claude-status-'$-"));
  try {
    const resources = join(directory, 'resources'); await mkdir(resources);
    const original = { model: 'fixture-model', permissions: { allow: ['Read'] }, hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf "EXISTING-HOOK\\n"' }] }],
    } };
    const file = join(directory, 'settings with spaces.json');
    await writeFile(file, JSON.stringify(original));
    for (const option of [['--settings', JSON.stringify(original)], ['--settings=./settings with spaces.json']]) {
      const args = [...option, '--', '--settings=literal-prompt'];
      const prepared = await claude.prepare({ command: { command: 'claude', args }, directory, resourceDirectory: resources });
      const launched = prepared.command.args;
      assert.deepEqual(launched.slice(-2), ['--', '--settings=literal-prompt']);
      const value = launched[launched.lastIndexOf('--settings', launched.indexOf('--')) + 1];
      const effective = JSON.parse(value.startsWith('{') ? value : await readFile(value, 'utf8'));
      assert.equal(effective.model, 'fixture-model');
      assert.deepEqual(effective.permissions, original.permissions);
      assert.deepEqual(effective.hooks.UserPromptSubmit[0], original.hooks.UserPromptSubmit[0]);
      assert.match(effective.hooks.UserPromptSubmit[1].hooks[0].command, /claude-reporter\.cjs/);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original, 'the user file is never rewritten');
      await prepared.cleanup?.();
      assert.deepEqual(await readdir(resources), []);
    }
    for (const value of ['{"hooks":{"Stop":42}}', './missing-settings.json']) {
      await assert.rejects(claude.prepare({ command: { command: 'claude', args: ['--settings', value] }, directory, resourceDirectory: resources }), value);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
