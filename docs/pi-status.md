# pi status integration

Workbench adds one `--extension <bundled pi-reporter.mjs>` to each pi invocation, before an argument delimiter if present. Existing explicit extensions, discovery settings, model arguments and saved Agent Settings remain unchanged. pi's `--no-extensions` disables discovery but still permits explicit extension paths. This Status Reporter registers only notification handlers through pi's official extension API: it registers no tools, changes no prompts, answers no UI and cancels no operations. Missing extension support or failure to load leaves the running terminal at Error without preventing input.

## Source and delivery

The extension reads the launch capability from `VIBEBRIDGE_STATUS_CONTEXT`. It subscribes to its own extension runner, not a child agent's event stream; a separately launched child pi does not receive the explicit extension argument merely by inheriting the environment.

Each callback captures its facts before any asynchronous delivery, and one queue delivers every report of the pi instance in order, including non-awaited UI notifications. `/reload` keeps that queue in the same process. Transport failures never throw into pi or return extension decisions; the next delivery reports observation loss before fresh evidence. A permanently unreachable listener cannot be told about the reporter's own failure.

Reports contain event names, assistant role and stopReason, idle and pending flags, and compaction outcome flags. Prompt text, UI titles, tool arguments and results, model messages and credentials stay in pi.

## Interpretation

- Session start, switch, fork and tree establish Ready when idle, or Busy if the official context reports ongoing work. `agent_start` clears the previous outcome and starts Busy.
- Ordinary tool activity stays Busy; individual tool failure does not end a turn. `agent_end` does not establish an outcome. Retry delays and automatic continuations stay Busy until a later reliable fact.
- `ui_prompt_start/end` delimit pi's coalesced outer blocking extension UI span. Waiting has priority over tool, compaction and agent activity. On release, active or pending work is Busy; otherwise the latest established idle or result fact becomes visible. This does not detect every natural-language question, tool approval or custom interaction.
- Assistant `message_end.stopReason` is held only for the current run segment, then corrected from the last assistant in `agent_end.messages` after all user message replacement handlers have run. `agent_settled` with no active or pending work resolves `stop` to Done and other final failures to Error. A settled `aborted: true` confirms main-run interruption even when the last assistant message has another outcome or is absent; an assistant `stopReason: aborted` also counts as interruption. Either returns Ready only with `isIdle: true` and `hasPendingMessages: false`. A missing outcome without confirmed interruption, length-limited output or an unfinished tool-call outcome is Error. New work clears prior outcome evidence.
- Official extension compaction callbacks are `session_before_compact`, `session_compact` and `session_compact_failed`. Processing and retries remain Busy. A failed automatic compaction is retained until final settlement unless a new agent segment or a newer assistant outcome establishes recovery, including continuation within the same tool loop. Completed manual compaction restores its prior idle or result fact; manual failure is Error. Cancelling compaction alone is not main-turn interruption.
- An existing extension can start another compaction before the observer receives the earlier completion. The observer retains the original idle or result fact across overlapping manual compactions and restores it only when a completion confirms idle, no pending messages and no retry. New agent work supersedes that saved fact; a later completion of the old compaction keeps any newly established outcome. UI waits still take priority.
- Shutdown or unload reports observation unavailable. Reload or later reliable events establish a fresh state; a held outcome does not survive observation loss.

## Known limits

These describe pi's installed extension interface and its [official extension documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md) at v1.4.0.

- Automatic retry and low-level compaction notifications are not all extension events; their names in other APIs do not imply extension delivery.
- An interruption during retry backoff may supply neither settled `aborted: true` nor an aborted assistant message, so it remains Error.
- Successful manual compaction may notify extensions while `isIdle()` is still false and emit no extension event after clearing that flag; the run then stays Busy until fresh evidence arrives.
- Compaction that fails before its before-callback, or is intercepted by an earlier user extension, may give incomplete observations.
- Existing extensions can start additional work during settlement; the observer samples official idle and pending facts but cannot predict work started by a later handler.

Requirements and evidence: [#93](https://github.com/a1457139709/VibeBridge/issues/93) and [#85](https://github.com/a1457139709/VibeBridge/issues/85).
