# Processing status integration

`ProcessingStatus` is owned by Workbench in the main process. It contains source validation, run association, recognizable ordering, CLI event interpretation, and the complete processing projection. The terminal host remains the authority for process lifecycle. No status is derived from terminal input, output, titles, liveness, or silence.

## Lifecycle and publication

Workbench prepares credentials for every launch, then passes their environment to the existing terminal host. Reports may arrive during startup; their facts are retained but are not visible or counted until the host reports the run as running. A running instance without a reliable fact projects Error. An initial reliable fact is used directly, without an intermediate Error requirement. Failed launches have no processing state and keep the existing launch feedback.

The host's stopping fact revokes report acceptance. Exit removes observations and membership. Controlled restarts and shutdown retain panel configuration according to the existing Workbench lifecycle. Main-process shutdown closes the reporting listener, discards all credentials and observations, and awaits adapter resource cleanup. Claude file-based invocation settings use private temporary files, removed on exit, launch failure or shutdown. There are no persistent processing records, additional observers, or additional process managers.

Every accepted visible transition publishes through the existing Workbench snapshot subscription. `snapshot.processing.runs` contains states keyed by run ID. `snapshot.processing.projects` contains Ready, Needs input, Done, and Error groups for every project (Busy is never summarized), each with `count` and `{panelId, runId}` members in panel order. These are computed together from running panels and the same observations. Frontends consume them directly, including background projects; they do not recount, deduplicate by session, or interpret events.

## Reporting contract

The launched process receives `VIBEBRIDGE_STATUS_CONTEXT`, a JSON object containing `url`, `runId`, `agent`, and a random per-launch `token`. Treat the token as a launch-local capability; never persist it or expose it through DesktopAPI. The endpoint listens only on loopback in the existing main process. POST a JSON object of at most 64 KiB:

```json
{
  "version": 1,
  "runId": "the launch run ID",
  "agent": "codex",
  "token": "the launch token",
  "scope": "main",
  "payload": { "hook_event_name": "UserPromptSubmit" },
  "id": "optional source event ID",
  "sequence": 12,
  "occurredAt": 1792530000000,
  "expiresAt": 1792530060000
}
```

Only version, launch identity, agent, token, scope, and payload are required. Optional metadata must come from reliable source evidence:

- `scope` is `main` or `child`. Reporters must identify child activity; session ID, directory, Agent Type, and parent-session ID never substitute for the launch identity.
- `id` identifies a source event across redelivery. IDs are remembered until the run ends.
- `sequence` is a nonnegative safe integer ordered across the main run. Do not invent independent counters in short-lived hook processes or use receipt order as source order.
- `occurredAt` and `expiresAt` are epoch milliseconds. Events known to precede this launch or a later accepted source timestamp, or to have expired, are discarded. Equal timestamps alone do not establish duplication.

Validation proceeds in this order: authenticate the launch and require an accepting lifecycle; validate the envelope; discard child, duplicate, old, or expired reports; then interpret the payload. Rejected and discarded events cannot change status, ordering, or counts. HTTP 403 means the launch credentials are absent, wrong, or revoked; 400 means malformed input; 413 means too large; 204 means processed, including intentional discard. Receipt is not proof of a visible transition.

There is no claim of perfect ordering when a source supplies no ordering information. Unidentifiable late events can still be misclassified; real integration validation must record that limitation. A valid current-run payload with no classification produces Error. Known auxiliary events can retain the current state.

Report `{ "observation": "lost" }` or `{ "observation": "unavailable" }` only with evidence. Both project Error and discard cached outcome evidence. `{ "observation": "restored" }` does not restore an old state; a fresh reliable event must establish it. An unavailable listener must not stop terminal launch or input. No heartbeat timeout infers a failure.

## CLI interpretation and evidence boundary

The three concrete adapters are internal to this module, dispatched by `app/main/status-events.ts`. They implement the mapping decisions in [spec #89](https://github.com/a1457139709/VibeBridge/issues/89). Hook payloads use `hook_event_name`; pi events use `type`. pi's assistant `message_end.message.stopReason` is held until `agent_settled`; retries reset that evidence and `agent_end` alone never means Done. Error also clears cached outcome evidence.

Codex treats a main-run `PreToolUse(request_user_input)` as waiting for the user; see [Codex status integration](codex-status.md). Its generic interruption mapping requires both `confirmed: true` and `can_accept_input: true`. These are evidence annotations the integration must supply after validating the actual CLI behavior, not assumptions based on terminal text. Without them, incomplete interruption evidence preserves state.

Codex and Claude launches add native command hooks through session-only configuration flags; pi adds an invocation-only official extension. See [Codex status integration](codex-status.md), [Claude status integration](claude-status.md) and [pi status integration](pi-status.md) for trust, preservation, source identity and evidence limits. A CLI that does not report a reliable state remains usable with Error. The simulated adapter paths and real-PTY transport tests cannot be cited as real CLI support evidence; task-specific validation belongs to the corresponding issue or PR.
