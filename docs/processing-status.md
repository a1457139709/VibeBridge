# Processing status integration

`ProcessingStatus` in the main process owns run association, CLI event interpretation and the processing state each run displays. The terminal host remains the authority for process lifecycle. Status is never derived from terminal input, output, titles, liveness or silence.

## Lifecycle and publication

Workbench prepares reporting credentials for every launch and passes them to the terminal host in the launch environment. Reports may arrive during startup; their facts are retained but are not visible or counted until the host reports the run as running. A running instance without a reliable fact projects Error. Failed launches have no processing state and keep the existing launch feedback.

The host's stopping fact revokes report acceptance. Exit removes observations and membership. Main-process shutdown closes the reporting listener, discards all credentials and observations, and awaits adapter resource cleanup.

Every accepted visible transition publishes through the existing Workbench snapshot subscription. Each panel in `snapshot.projects[].panels` (resident panels) and `snapshot.projects[].tray` (tray panels) is a panel view carrying its current run and, while that run is running, its `status`: the observed state, or Error without a reliable observation. Panels without a running run have no `status`. Frontends read status from the same panel views everywhere, including background projects; the project summary in the workspace toolbar groups the current project's resident panels, then its tray panels, by `status` into Ready, Needs input, Done and Error in that order (Busy is never summarized), so counts and members come from one projection. Frontends do not deduplicate by session or interpret events.

## Current session

Each interpreter also reports the ID of the session its run is on now, following `/clear`, `/resume` and forks; it is undefined before the first session and after the current one ends, and Errors keep it. `ProcessingStatus` keeps it with the run's observation, so it disappears when the observation is released. A session change of a running run publishes a snapshot.

Run Supervision answers one query from it, locating a session: the project and panel whose current run is on that session now, or none. Dispatch records store only session IDs and use this query to find a panel ([ADR 0003](adr/0003-dispatch-records-point-to-sessions.md)). A run can also hold pending dispatches: each is handed the run's session ID at once if the run is on a session, otherwise on the first report of one, and is dropped unpersisted if the run ends first, its holder told. A run can likewise be waited on until it first reports ready (at once if it has reported ready before, whatever it shows now); a dispatch that fills a new panel pastes its command then. Session IDs only locate panels; they are never used to resume a session.

## Reports

Each Agent Type's Status Reporter runs inside the CLI process and sends reports to a listener on loopback in the main process. The launch environment carries `VIBEBRIDGE_STATUS_CONTEXT`, a JSON object with `url`, `runId`, `agent` and a random per-launch `token`. The token is a launch-local capability: it is never persisted or exposed through DesktopAPI. Launch environments drop every inherited `VIBEBRIDGE_` variable, so a Workbench started inside another Workbench's terminal never hands that Workbench's context to its own runs; a launch that cannot be safely extended carries no context at all.

A report is one POST of a JSON object of at most 64 KiB:

```json
{
  "runId": "the launch run ID",
  "agent": "codex",
  "token": "the launch token",
  "payload": { "hook_event_name": "UserPromptSubmit", "session_id": "..." }
}
```

A report whose run, token or agent does not match an accepting launch is rejected with 403; a payload that is not an object is rejected with 400. Status Reporters treat only 204 as delivered. An accepted payload goes to the run's interpreter.

The payload format belongs to each Agent Type: its Status Reporter and interpreter live together in `app/main/agent-status/<agent>/` and ship in the same build. The one shared payload is `{ "observation": "lost" }`, sent when a Status Reporter cannot forward a fact. It projects Error; the next reliable fact establishes a state again.

## Agent Type adapters

Each Agent Type has one adapter under `app/main/agent-status/<agent>/`, implementing the `StatusAdapter` contract in `app/main/agent-status/adapter.ts`. `ProcessingStatus` holds them in a closed table keyed by Agent Type, so CLI protocol differences stay inside this module. Callers never see an adapter.

- `prepare` adds the Agent Type's Status Reporter to one launch and may return a cleanup for invocation resources. It never rewrites user files and throws when existing configuration cannot be safely extended; `ProcessingStatus` then launches the original command without reporting credentials, observed as Error.
- `observe` creates one interpreter per Agent Run. Its `accept` receives authenticated main-run CLI facts, never observation reports, and returns a state, Keep for a known auxiliary fact, or Discard for an identifiable child, stale or duplicate fact. A fact it cannot classify is Error.
- After every Error, whether classified, reported as observation loss or caused by listener failure, `ProcessingStatus` calls `discardEvidence`. It discards outcome evidence such as pending waits, tools in progress and held stop reasons, and keeps session identity and duplicate records so stale facts stay discarded.

Hook-based Status Reporters run as one short-lived process per event, so their reports carry no shared order; an interpreter can discard only facts it identifies as stale or duplicate, and an unidentifiable late fact can still be misclassified. Status Reporters live beside their adapters as `<agent>/reporter.ts`, bundled as `<agent>-reporter.cjs` or `.mjs`, and share the transport in `app/main/agent-status/reporter.ts`.

To add an Agent Type:

1. Add `app/main/agent-status/<agent>/status.ts` and `reporter.ts`, a build entry for the reporter in `scripts/build.mjs` and `scripts/test.mjs`, and the adapter's entry in the `ProcessingStatus` table (TypeScript rejects a missing one).
2. Add its samples to `tests/agent-status-contract.test.ts` and pass the contract.
3. Test its interpretation rules through the adapter interface, and its launch and Status Reporter with a CLI double in `tests/fixtures/<agent>-cli.cjs` inside a real PTY.
4. Document trust, preservation, identity and known limits in `docs/<agent>-status.md`.

## CLI interpretation

The mapping decisions are in [spec #89](https://github.com/a1457139709/VibeBridge/issues/89). Codex and Claude launches add native command hooks through session-only configuration flags, and their payloads name events with `hook_event_name`; pi adds an invocation-only official extension, and its payloads name events with `type`. See [Codex status integration](codex-status.md), [Claude status integration](claude-status.md) and [pi status integration](pi-status.md). A CLI that does not report a reliable state remains usable with Error.
