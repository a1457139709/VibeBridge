# Codex status integration

Workbench adds command hooks to its Codex launches with `-c hooks.<Event>=...` and disables automatic attachment to Codex's shared daemon for that invocation, so the native interactive CLI stays in the terminal host. The bundled Status Reporter `codex-reporter.cjs` runs briefly for each hook using the application's Electron binary in Node mode.

User, project, system and plugin hooks remain under Codex's config loader. Hooks supplied in the Agent Settings command-line arguments are retained when the session layer is augmented. Saved Agent Settings, the user's Codex home, profiles, hooks files and notify command are unchanged. If launch preparation cannot safely parse an existing hook override, Workbench launches the original command, observed as Error. Custom launch wrappers must forward the additional arguments and inherited environment to the local CLI.

## Native trust

Codex requires review of new or changed non-managed hooks. In its startup prompt or `/hooks`, review the twelve session hooks whose command invokes VibeBridge's `codex-reporter.cjs`, then choose whether to trust them. Codex owns that decision, keyed to the hook command: a VibeBridge version that changes the reporter's path or the application's location asks for review again. Disabled hooks and managed hook policy stay as Codex has them. Until a reliable event arrives, the running panel displays Error while its terminal remains usable. Trusting after startup may miss SessionStart; the next accepted main event can establish state.

The Status Reporter forwards only `hook_event_name`, `session_id`, `source`, `turn_id`, `agent_id`, `tool_name` and `tool_use_id`. Prompts, transcript paths, tool inputs and outputs stay in Codex. It produces no hook decision, continuation prompt or model context. Malformed or oversized hook input is reported as observation loss. Requests are bounded, and reporter failure never rejects user input. A hook that is disabled, killed before reporting or unable to reach the listener cannot report its own failure, so the previous status remains.

## Association and interpretation

`session_id` associates events within one run, and the current one is reported for locating the panel on a session (see [current session](processing-status.md#current-session)). `agent_id` and SubagentStart/SubagentStop identify child activity, which cannot change the main run. SessionEnd retires the session without declaring the process exited. A new SessionStart can associate startup, resume, clear or fork with the same terminal run.

Known retired sessions and turns, and repeated tool boundaries identified by session, turn, event and tool-use ID, are discarded. A turn ID is not a unique event ID: Stop-hook continuation may submit again within a turn.

| Native fact | Projection |
| --- | --- |
| SessionStart: startup, resume, clear, fork | Ready |
| UserPromptSubmit | Busy; answers any pending question |
| Ordinary tools; compaction; compact SessionStart | Busy unless a wait or an unanswered async question remains |
| PermissionRequest | Needs input |
| PreToolUse(request_user_input) | Needs input, pending by `tool_use_id` |
| Matching PostToolUse after permission request or question | Busy; other pending tool waits remain Needs input |
| PreToolUse(request_user_input_async) | Needs input until the user enters anything, the turn is interrupted, a new session starts or the run exits |
| Stop | Done; Needs input while an async question is unanswered |
| Main Interrupt with a turn ID | Ready: the native hook runs after detaching the active turn; clears waits and an unanswered async question |
| SessionEnd; child events | Keep current state |
| Unclassified main event; reported observation loss | Error |

Unrelated tool activity does not clear a known permission wait. A matching result, a new prompt, main completion or an interruption with a turn ID resolves it. Native PermissionRequest input omits `tool_use_id`: such an unidentified wait remains until a new turn, completion or interruption, even after an approval may have been answered, because an arbitrary PostToolUse cannot prove which request it resolved. A tool's nonzero exit is still tool activity, not a failed turn.

## Structured questions

A main-run `PreToolUse(request_user_input)` is itself evidence of waiting for the user. The handler awaits the answer in every allowed mode until it is answered, cancelled or automatically resolved. Its Plan-only `is_blocking` flag controls only whether the TUI may resolve the question automatically, and only the root thread can ask.

The question is a pending wait keyed by `tool_use_id`, or by tool name when that ID is missing. Its matching PostToolUse removes it; the run returns to Busy only when no other wait, such as a permission request, remains. Codex runs PostToolUse only for successful results: an answer or automatic resolution succeeds, while cancelling in the TUI (Esc or Ctrl-C) interrupts the turn, and that Interrupt clears the wait. A new turn, UserPromptSubmit, Stop and run exit also clear it. Child questions cannot change the main run.

`request_user_input_async` shows its questions and returns `{"accepted":true}` at once, so its own PostToolUse does not mean the user answered. A main-run `PreToolUse(request_user_input_async)` sets an unanswered-question mark, kept apart from the waits above. While it is set, tools (including that question's own result), compaction, a compact SessionStart and Stop all project Needs input, and a new turn ID does not clear it. Any UserPromptSubmit clears it, including input that is unrelated to the question or steered into a running turn, because Workbench never reads the conversation; so do a main Interrupt with a turn ID, a non-compact SessionStart, observation loss and run exit.

## Known limits

These describe Codex 0.164.0, the version the hook and question behavior was read from.

- In Default mode, if the user does nothing, Needs input lasts up to about two minutes before automatic resolution returns the run to Busy. This matches the actual wait.
- Default-mode free-text questions have no confirmed waiting signal.
- UserPromptSubmit can be observed before another hook rejects submission, PermissionRequest before another hook grants or denies permission, and Stop before a hook requests continuation; Stop has no success or failure field. These can misclassify state until a later reliable event.
- Network or server failures without an applicable hook may leave Busy.
- Input steered into a running turn triggers UserPromptSubmit, with the same turn ID, only when the turn drains pending input before its next step. An answer typed during a turn therefore leaves Needs input one step later.
- Spawned Tasks are not observable, so Done can arrive while one still runs. Stop carries no background-task field. SubagentStart runs only when a spawned agent starts, but SubagentStop runs after each of its turns, so a child woken by later input has no start signal; internal sub-agents run no hooks; background commands run no hook.

Requirements and evidence: [#91](https://github.com/a1457139709/VibeBridge/issues/91), [#85](https://github.com/a1457139709/VibeBridge/issues/85), [#151](https://github.com/a1457139709/VibeBridge/issues/151) and the [structured-question investigation](https://github.com/a1457139709/VibeBridge/issues/75#issuecomment-6308791014). Protocol references: [official hooks guide](https://learn.chatgpt.com/docs/hooks), [native hook dispatch](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/hook_runtime.rs), [pending input](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/session/turn.rs), [question handler](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/handlers/request_user_input.rs) and [async question handler](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs).
