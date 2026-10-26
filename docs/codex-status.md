# Codex status integration

Workbench adds command hooks to its Codex launches with `-c hooks.<Event>=...` and disables automatic attachment to Codex's shared daemon for that invocation. The native interactive CLI stays in the existing terminal host. It does not start an additional App Server or observer. The bundled Status Reporter `codex-reporter.cjs` runs briefly using the application's Electron binary in Node mode. There are no per-run hook files to clean up; stopping revokes the run capability and exit discards its observations.

User, project, system and plugin hooks remain under Codex's config loader. Hooks supplied in the Agent Settings command-line arguments are retained when the session layer is augmented. Saved Agent Settings, the user's Codex home, profiles, hooks files and notify command are not replaced. If launch preparation cannot safely parse an existing hook override, Workbench launches the original command with unavailable observation instead of rewriting it. Custom launch wrappers must forward the additional arguments and inherited environment to the local CLI.

## Native trust

Codex requires review of new or changed non-managed hooks. In its startup prompt or `/hooks`, review the twelve session hooks whose command invokes VibeBridge's `codex-reporter.cjs`, then choose whether to trust them. Codex owns persistence of that decision, keyed to the hook command: a VibeBridge version that changes the reporter's path or the application's location asks for review again. Workbench neither writes trusted hashes nor adds `--dangerously-bypass-hook-trust`; it does not enable disabled hooks or override managed hook policy. Until a reliable event arrives, the running panel displays Error while its terminal remains usable. Trusting after startup may miss SessionStart; the next accepted main event can establish state.

The reporter sends only event identity and classification fields to the existing loopback listener. It excludes prompts, transcript paths, tool inputs and outputs. It produces no hook decision, continuation prompt or additional model context. Malformed or oversized input that reaches the reporter is reported as observation loss. Network requests are bounded; reporter failure never rejects user input. A hook that is disabled, killed before reporting, or unable to reach the listener cannot report its own failure: no silence timeout changes the previous status.

## Association and interpretation

The run ID and random launch token authenticate every report before any Codex interpretation. `session_id` associates events only within that run. Native `agent_id` and SubagentStart/SubagentStop identify child activity, which cannot change the main run. SessionEnd retires session association without declaring the managed process exited. A new SessionStart can associate startup, resume, clear or fork with the same terminal run.

Known retired sessions and turns, and repeated tool boundaries identified by session, turn, event and tool-use ID, are discarded. A turn ID is not a unique event ID: Stop-hook continuation may submit again within a turn. No sequence or timestamp is manufactured in independent reporters. Events without recognizable ordering can still arrive late; the adapter cannot reconstruct a perfect source order.

The mappings remain approximations:

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
| Unclassified valid main event; reported observation loss | Error |

Unrelated tool activity does not clear a known permission wait. A matching result, a new prompt, main completion or confirmed interruption can resolve it. Current native PermissionRequest input omits `tool_use_id`: such an unidentified wait remains until a new turn, completion or interruption, even after an approval may have been answered. An arbitrary PostToolUse cannot prove which request it resolved. A tool's nonzero exit is still tool activity, not proof of a failed turn. The generic reporting interface continues to require explicit interruption confirmation; only the native adapter applies the verified Interrupt contract.

## Structured questions

A main-run `PreToolUse(request_user_input)` is itself evidence of waiting for the user; no `blocking` annotation is required, and generic reports that still send `blocking: true` are accepted. In 0.163.0 the handler awaits the answer in every allowed mode until it is answered, cancelled or automatically resolved. Its Plan-only `is_blocking` flag controls only whether the TUI may resolve the question automatically, and only the root thread can ask. `permission_mode` describes approval policy and must not be treated as Plan/Default mode.

The question is a pending wait keyed by `tool_use_id`, or by tool name when that ID is missing. Its matching PostToolUse (or PostToolUseFailure from a generic report) removes it; the run returns to Busy only when no other wait, such as a permission request, remains. Codex runs PostToolUse only for successful results. An answer or automatic resolution succeeds; cancelling in the TUI (Esc or Ctrl-C) interrupts the turn, so the confirmed Interrupt clears the wait. A new turn, UserPromptSubmit, Stop and run exit also clear it. `request_user_input_async` returns immediately and remains ordinary tool activity. Child questions cannot change the main run.

Known limitation: in Default mode, if the user does nothing, Needs input lasts up to about two minutes before automatic resolution returns the run to Busy. This matches the actual wait. The source evidence covers only 0.163.0; later versions are adjusted after real validation.

## Limits to verify with a real CLI

Default-mode free-text questions have no confirmed universal waiting signal. Experimental question availability and mode differences must be recorded separately in real validation.

UserPromptSubmit can be observed before another hook rejects submission. PermissionRequest can be observed before another hook grants or denies permission. Stop can be observed before a hook requests continuation; it has no success/failure field. These can transiently or persistently misclassify state until a later reliable event. Network/server failures without an applicable hook may leave Busy. The adapter does not infer outcomes from terminal text, titles, process liveness or elapsed time.

The authoritative requirements and evidence are [#91](https://github.com/a1457139709/VibeBridge/issues/91), [#85](https://github.com/a1457139709/VibeBridge/issues/85) and the [structured-question investigation](https://github.com/a1457139709/VibeBridge/issues/75#issuecomment-6308791014). Protocol references: [official hooks guide](https://learn.chatgpt.com/docs/hooks), [native hook dispatch](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/hook_runtime.rs), [question handler](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/handlers/request_user_input.rs) and [async question handler](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs). These references explain the implementation; automated fixtures alone do not qualify Codex's real support.
