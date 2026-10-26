import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentType } from '../app/shared/model';
import type { Outcome, Payload, StatusAdapter } from '../app/main/agent-status/adapter';
import { codex } from '../app/main/agent-status/codex/status';
import { claude } from '../app/main/agent-status/claude/status';
import { pi } from '../app/main/agent-status/pi/status';

/** Every Agent Type's adapter must pass this contract. Each sample is a sequence of CLI
 * facts, as its Status Reporter sends them, whose last fact has the named outcome.
 */
interface Contract {
  adapter: StatusAdapter;
  /** Arguments reaching this Agent Type's own configuration path, given a settings.json in the project. */
  configured: string[];
  /** Configuration the adapter cannot safely understand, or null when it reads none. */
  unsafe: string[] | null;
  ready: Payload[]; busy: Payload[]; waiting: Payload[]; done: Payload[];
  /** A known auxiliary fact that keeps the current state. */
  auxiliary: Payload[];
  /** A valid current-run fact with no classification. */
  unclassified: Payload[];
  /** A distinct progress fact per id: Needs input while a wait is pending, otherwise Busy. */
  progress: (id: string) => Payload;
  /** A fact from a session this run has retired, or null without session identity. */
  retired: { before: Payload[]; stale: Payload } | null;
}

const hook = (hook_event_name: string, fields: Payload = {}) => ({ hook_event_name, session_id: 'session', ...fields });
const fact = (type: string, fields: Payload = {}) => ({ type, isIdle: false, hasPendingMessages: false, ...fields });

const contracts: Record<AgentType, Contract> = {
  codex: {
    adapter: codex, configured: ['-c', 'hooks.Stop=[]'], unsafe: ['-c', 'hooks=1'],
    ready: [hook('SessionStart', { source: 'startup' })],
    busy: [hook('UserPromptSubmit', { turn_id: 'turn' })],
    waiting: [hook('UserPromptSubmit', { turn_id: 'turn' }), hook('PermissionRequest', { turn_id: 'turn', tool_use_id: 'approval', tool_name: 'Bash' })],
    done: [hook('UserPromptSubmit', { turn_id: 'turn' }), hook('Stop', { turn_id: 'turn' })],
    auxiliary: [hook('UserPromptSubmit', { turn_id: 'turn' }), hook('SessionEnd')],
    unclassified: [hook('Unclassified')],
    progress: id => hook('PreToolUse', { turn_id: 'turn', tool_use_id: id, tool_name: 'Bash' }),
    retired: { before: [hook('SessionStart', { source: 'startup', session_id: 'old' }), hook('SessionStart', { source: 'clear' })],
      stale: hook('Stop', { session_id: 'old' }) },
  },
  claude: {
    adapter: claude, configured: ['--settings', 'settings.json'], unsafe: ['--settings', '[]'],
    ready: [hook('SessionStart', { source: 'startup' })],
    busy: [hook('UserPromptSubmit')],
    waiting: [hook('UserPromptSubmit'), hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'question' })],
    done: [hook('UserPromptSubmit'), hook('Stop')],
    auxiliary: [hook('UserPromptSubmit'), hook('SessionEnd')],
    unclassified: [hook('Unclassified')],
    progress: id => hook('PreToolUse', { tool_name: 'Read', tool_use_id: id }),
    retired: { before: [hook('SessionStart', { source: 'startup', session_id: 'old' }), hook('SessionStart', { source: 'clear' })],
      stale: hook('Stop', { session_id: 'old' }) },
  },
  pi: {
    adapter: pi, configured: ['--extension', './mine.mjs'], unsafe: null,
    ready: [fact('session_start', { isIdle: true })],
    busy: [fact('agent_start')],
    waiting: [fact('agent_start'), fact('ui_prompt_start')],
    done: [fact('agent_start'), fact('message_end', { message: { role: 'assistant', stopReason: 'stop' } }), fact('agent_settled', { isIdle: true })],
    auxiliary: [fact('agent_start'), fact('message_end', { message: { role: 'user' } })],
    unclassified: [fact('unclassified')],
    progress: () => fact('tool_execution_start'),
    retired: null,
  },
};

/** Feeds facts the way ProcessingStatus does: every Error discards outcome evidence. */
function observe(adapter: StatusAdapter) {
  const interpreter = adapter.observe();
  const accept = (payload: Payload): Outcome => {
    const outcome = interpreter.accept(payload);
    if (outcome === 'error') interpreter.discardEvidence();
    return outcome;
  };
  return { interpreter, accept, feed: (facts: Payload[]) => facts.map(accept).at(-1) };
}

for (const [agent, contract] of Object.entries(contracts)) {
  test(`${agent}: launch preparation keeps the user's arguments, rejects unsafe configuration and cleans up`, async () => {
    const directory = await mkdtemp(resolve('work/agent-status-contract-'));
    try {
      const resources = join(directory, 'resources');
      await writeFile(join(directory, 'settings.json'), '{}');
      await mkdir(resources);
      for (const before of [[], contract.configured]) {
        const command = { command: 'cli', args: [...before, '--', 'literal --settings'] };
        const prepared = await contract.adapter.prepare({ command, directory, resourceDirectory: resources });
        assert.equal(prepared.command.command, 'cli');
        assert.deepEqual(prepared.command.args.slice(0, before.length), before);
        assert.deepEqual(prepared.command.args.slice(-2), ['--', 'literal --settings']);
        assert.ok(prepared.command.args.length > command.args.length, 'the Status Reporter is added');
        await prepared.cleanup?.();
        await prepared.cleanup?.();
        assert.deepEqual(await readdir(resources), [], 'no invocation resources remain');
      }
      if (contract.unsafe) await assert.rejects(contract.adapter.prepare({
        command: { command: 'cli', args: contract.unsafe }, directory, resourceDirectory: resources }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test(`${agent}: each sample reaches its state, auxiliary facts keep it and unclassified facts are Error`, () => {
    for (const [sample, expected] of [['ready', 'ready'], ['busy', 'busy'], ['waiting', 'needs-input'], ['done', 'done'],
      ['auxiliary', 'keep'], ['unclassified', 'error']] as const) {
      assert.equal(observe(contract.adapter).feed(contract[sample]), expected, sample);
    }
  });

  test(`${agent}: discarding evidence ends a wait but keeps session identity`, () => {
    const waiting = observe(contract.adapter);
    waiting.feed(contract.waiting);
    assert.equal(waiting.accept(contract.progress('first')), 'needs-input', 'a wait outlives progress');
    waiting.interpreter.discardEvidence();
    assert.equal(waiting.accept(contract.progress('second')), 'busy');
    if (contract.retired) {
      const retired = observe(contract.adapter);
      retired.feed(contract.retired.before);
      retired.interpreter.discardEvidence();
      assert.equal(retired.accept(contract.retired.stale), 'discard');
    }
  });

  test(`${agent}: interpreters of two runs are independent`, () => {
    const first = observe(contract.adapter), second = observe(contract.adapter);
    first.feed(contract.waiting);
    second.feed(contract.busy);
    assert.equal(second.accept(contract.progress('progress')), 'busy');
    assert.equal(first.accept(contract.progress('progress')), 'needs-input');
  });
}
