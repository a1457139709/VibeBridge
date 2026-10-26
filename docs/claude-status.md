# Claude Code status integration

Workbench augments the effective invocation's `--settings` with native command hooks. It reads a settings-file argument relative to the Project Directory, retaining its values and handlers in a private temporary file under the Workbench data directory. The temporary directory is owner-only and the file has mode 0600; file contents never become process arguments. Inline JSON remains inline. The original file and saved Agent Settings are unchanged. User, project, local and managed settings remain under Claude's loader. Custom command wrappers must forward the added arguments and inherited environment. Invalid or unreadable invocation settings fall back to the original command with unavailable observation; disabled hooks and managed policy are not overridden.

The bundled Status Reporter `claude-reporter.cjs` runs briefly using Electron in Node mode. It sends selected identity fields to the existing main-process listener, emits no hook decisions or model context, and exits successfully even when reporting fails. Requests are bounded. Prompts, transcripts, tool content and answers are excluded; a deterministic digest of tool name and input supports permission association without transferring their contents. Oversized or malformed input reaching the reporter becomes observation loss. There are no permanent configuration changes, observers or second lifecycle managers. Stopping revokes the capability; exit or launch failure removes observations and any temporary settings file. Workbench shutdown awaits cleanup and reports failures. Abrupt termination before cleanup can leave an owner-only temporary directory in application data.

Claude's native login, project trust and policy still apply. Workbench does not approve trust or bypass permissions. Until reliable events arrive the running panel is Error and the terminal remains available. Hooks disabled, killed before reporting, or unable to reach the listener cannot report their own loss: silence alone never changes status.

## Association and waiting

The launch token and run ID authenticate reports before native event interpretation. Session IDs and prompt IDs only distinguish observations within that run; they never authorize a report or associate separate panels. Native `agent_id` and SubagentStart/SubagentStop identify child activity, which cannot end or otherwise change the main run. Retired sessions/prompts, duplicate prompt submissions, identified elicitation/tool boundaries and late starts after their results are discarded where identifiable. Stop is not deduplicated by prompt ID because continuation hooks can legitimately produce multiple stops. A native resume may associate a previously retired session again. No independent reporter manufactures a sequence or timestamp.

| Native event | Projection |
| --- | --- |
| SessionStart | Approximately Ready; compact source stays Busy, preserving pending waits |
| UserPromptSubmit; ordinary tools; compaction | Busy unless an unresolved wait remains |
| PreToolUse(AskUserQuestion); PermissionRequest; Elicitation | Needs input |
| Matching question/tool result or ElicitationResult | Busy when all known waits have resolved |
| Main Stop | Done, meaning this turn ended |
| Main StopFailure | Error |
| SessionEnd; child events | Preserve the main state; host exit removes the run |
| Valid unclassified event; reported observation loss | Error |

PermissionRequest lacks a tool-use ID. The adapter binds its input digest to a tool ID only when exactly one active PreToolUse has matching input. Otherwise it retains an unidentified wait until a new prompt, main completion/failure or session start. Tool-name equality or an unrelated result never clears it. Hook changes to inputs or ambiguous identical concurrent calls can therefore leave Needs input longer than the actual wait. Elicitations are matched by server and optional elicitation ID; requests without distinct IDs cannot be perfectly distinguished.

## Test entry points

`npm test`, `npm run check` and the pre-commit hook include the Claude module suites. Interpretation and launch-preparation rules are tested through the adapter interface. A few suites launch `tests/fixtures/claude-cli.cjs` with Node.js inside a real PTY, exercising production command hooks, the Status Reporter and Workbench state with simulated native events. They do not launch the installed Claude program, log into an account, or contact Claude's service. Shared Workbench tests also use controlled fixture commands for all Agent Types.

The existing GitHub Actions **Checks** workflow includes these module suites and the Claude production desktop suite on normal push/PR runs and manual **Run workflow** runs. Desktop suites remain restricted to GitHub-hosted macOS and use the same simulated CLI; no account credentials are needed.

Real CLI acceptance is a separate, user-controlled activity. Starting the actual Claude program, authentication and model requests are not invoked by these test commands or this workflow. Simulated tests cannot prove that a real Claude version emits the expected events. The agent must not automatically run or retry real Claude acceptance; the user performs it manually.

## Approximation and evidence limits

Hooks observe an event before all other hooks have made their decisions. Existing hooks may reject a prompt, answer or deny permission/questions, or require Stop continuation. A callback can be skipped by another hook's rejection; a reported callback can also precede that rejection. Subsequent valid facts update status, with no waiting timeout. A Stop that requests continuation can show Done too early. Elicitation answered by another hook can omit ElicitationResult and leave a wait until a later decisive fact.

A single tool failure remains Busy; automatic retry without a final failure event preserves Busy. StopFailure covers reported API turn failures, not every error or interruption. There is no general native interruption-to-Ready rule and no claim that free-text questions are detectable. Terminal text, titles, liveness and elapsed time never establish a state. Events lacking stable identity/order can still arrive late or twice.

Support is qualified separately for this CLI. Rule tests and the production desktop suite do not prove a real model-driven Ready/Busy/Done loop. See [implementation and verification #92](https://github.com/a1457139709/VibeBridge/issues/92) and [per-CLI evidence #85](https://github.com/a1457139709/VibeBridge/issues/85) for execution versions, traces, known deviations and unverified behavior. There is no historical compatibility range or version gate.

Protocol references: [native hooks](https://code.claude.com/docs/en/hooks), [invocation flags](https://code.claude.com/docs/en/cli-reference), [settings precedence](https://code.claude.com/docs/en/settings).
