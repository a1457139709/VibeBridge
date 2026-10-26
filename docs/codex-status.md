# Codex status integration

Workbench adds command hooks to its Codex launches with `-c hooks.<Event>=...` and disables automatic attachment to Codex's shared daemon for that invocation, so the native interactive CLI stays in the terminal host. The bundled Status Reporter `codex-reporter.cjs` runs briefly for each hook using the application's Electron binary in Node mode.

User, project, system and plugin hooks remain under Codex's config loader. Hooks supplied in the Agent Settings command-line arguments are retained when the session layer is augmented. Saved Agent Settings, the user's Codex home, profiles, hooks files and notify command are unchanged. If launch preparation cannot safely parse an existing hook override, Workbench launches the original command, observed as Error. Custom launch wrappers must forward the additional arguments and inherited environment to the local CLI.

## Native trust

Codex requires review of new or changed non-managed hooks. In its startup prompt or `/hooks`, review the twelve session hooks whose command invokes VibeBridge's `codex-reporter.cjs`, then choose whether to trust them. Codex owns that decision, keyed to the hook command: a VibeBridge version that changes the reporter's path or the application's location asks for review again. Disabled hooks and managed hook policy stay as Codex has them. Until a reliable event arrives, the running panel displays Error while its terminal remains usable. Trusting after startup may miss SessionStart; the next accepted main event can establish state.

The Status Reporter forwards only `hook_event_name`, `session_id`, `source`, `turn_id`, `agent_id`, `tool_name` and `tool_use_id`. Prompts, transcript paths, tool inputs and outputs stay in Codex. It produces no hook decision, continuation prompt or model context. Malformed or oversized hook input is reported as observation loss. Requests are bounded, and reporter failure never rejects user input. A hook that is disabled, killed before reporting or unable to reach the listener cannot report its own failure, so the previous status remains.

## Association and interpretation

`session_id` associates events within one run. `agent_id` and SubagentStart/SubagentStop identify child activity, which cannot change the main run. SessionEnd retires the session without declaring the process exited. A new SessionStart can associate startup, resume, clear or fork with the same terminal run.

Known retired sessions and turns, and repeated tool boundaries identified by session, turn, event and tool-use ID, are discarded. A turn ID is not a unique event ID: Stop-hook continuation may submit again within a turn.

| Native fact | Projection |
| --- | --- |
| SessionStart: startup, resume, clear, fork | Ready |
| UserPromptSubmit; ordinary tools; compaction; compact SessionStart | Busy |
| PermissionRequest | Needs input |
| PreToolUse(request_user_input) | Needs input, pending by `tool_use_id` |
| Matching PostToolUse after permission request or question | Busy; other pending tool waits remain Needs input |
| PreToolUse(request_user_input_async) | Busy: ordinary tool activity |
| Stop | Done |
| Main Interrupt with a turn ID | Ready: the native hook runs after detaching the active turn |
| SessionEnd; child events | Keep current state |
| Unclassified main event; reported observation loss | Error |

Unrelated tool activity does not clear a known permission wait. A matching result, a new prompt, main completion or an interruption with a turn ID resolves it. Native PermissionRequest input omits `tool_use_id`: such an unidentified wait remains until a new turn, completion or interruption, even after an approval may have been answered, because an arbitrary PostToolUse cannot prove which request it resolved. A tool's nonzero exit is still tool activity, not a failed turn.

## Structured questions

A main-run `PreToolUse(request_user_input)` is Needs input in every collaboration mode until the question is answered, cancelled or automatically resolved.

The question is a pending wait keyed by `tool_use_id`, or by tool name when that ID is missing. Its matching PostToolUse removes it; the run returns to Busy only when no other wait, such as a permission request, remains. Codex runs PostToolUse only for successful results: an answer or automatic resolution succeeds, while cancelling in the TUI (Esc or Ctrl-C) interrupts the turn, and that Interrupt clears the wait. A new turn, UserPromptSubmit, Stop and run exit also clear it. `request_user_input_async` returns immediately and remains ordinary tool activity. Child questions cannot change the main run.

## Known limits

These describe Codex 0.163.0.

- In Default mode, if the user does nothing, Needs input lasts up to about two minutes before automatic resolution returns the run to Busy. This matches the actual wait.
- Default-mode free-text questions have no confirmed waiting signal.
- UserPromptSubmit can be observed before another hook rejects submission, PermissionRequest before another hook grants or denies permission, and Stop before a hook requests continuation; Stop has no success or failure field. These can misclassify state until a later reliable event.
- Network or server failures without an applicable hook may leave Busy.

Requirements and evidence: [#91](https://github.com/a1457139709/VibeBridge/issues/91), [#85](https://github.com/a1457139709/VibeBridge/issues/85) and the [structured-question investigation](https://github.com/a1457139709/VibeBridge/issues/75#issuecomment-6308791014). Protocol references: [official hooks guide](https://learn.chatgpt.com/docs/hooks), [native hook dispatch](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/hook_runtime.rs), [question handler](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/handlers/request_user_input.rs) and [async question handler](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs).
