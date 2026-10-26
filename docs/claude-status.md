# Claude Code status integration

Workbench augments the effective invocation's `--settings` with native command hooks. It reads a settings-file argument relative to the Project Directory, retaining its values and handlers in a private temporary file under the Workbench data directory. The temporary directory is owner-only and the file has mode 0600; file contents never become process arguments. Inline JSON remains inline. The original file and saved Agent Settings are unchanged. User, project, local and managed settings remain under Claude's loader. Custom command wrappers must forward the added arguments and inherited environment. Invalid or unreadable invocation settings fall back to the original command, observed as Error; disabled hooks and managed policy stay as Claude has them.

The bundled Status Reporter `claude-reporter.cjs` runs briefly for each hook using Electron in Node mode. It forwards selected identity fields, emits no hook decisions or model context, and exits successfully even when reporting fails. Requests are bounded. Prompts, transcripts, tool content and answers stay in Claude; a digest of tool name and input supports permission association without transferring their contents. Oversized or malformed hook input becomes observation loss. Exit or launch failure removes observations and any temporary settings file, and Workbench shutdown awaits that cleanup and reports failures. Abrupt termination before cleanup can leave an owner-only temporary directory in application data.

Claude's native login, project trust and policy still apply. Until reliable events arrive the running panel is Error and the terminal remains available. A hook that is disabled, killed before reporting or unable to reach the listener cannot report its own loss, so the previous status remains.

## Association and waiting

Session IDs and prompt IDs distinguish observations within one run; they never associate separate panels. `agent_id` and SubagentStart/SubagentStop identify child activity, which cannot change the main run. Retired sessions and prompts, duplicate prompt submissions, identified elicitation and tool boundaries, and late tool starts after their results are discarded. Stop is not deduplicated by prompt ID because continuation hooks can legitimately produce multiple stops. A native resume may associate a previously retired session again.

| Native event | Projection |
| --- | --- |
| SessionStart | Ready; compact source stays Busy, preserving pending waits |
| UserPromptSubmit; ordinary tools; compaction | Busy unless an unresolved wait remains |
| PreToolUse(AskUserQuestion); PermissionRequest; Elicitation | Needs input |
| Matching question/tool result or ElicitationResult | Busy when all known waits have resolved |
| Main Stop | Done, meaning this turn ended |
| Main StopFailure | Error |
| SessionEnd; child events | Keep the main state; host exit removes the run |
| Unclassified event; reported observation loss | Error |

PermissionRequest lacks a tool-use ID. The adapter binds its input digest to a tool ID only when exactly one active PreToolUse has matching input. Otherwise it retains an unidentified wait until a new prompt, main completion or failure, or session start; tool-name equality or an unrelated result does not clear it. Hook changes to inputs or identical concurrent calls can therefore leave Needs input longer than the actual wait. Elicitations are matched by server and optional elicitation ID; requests without distinct IDs cannot be told apart.

## Known limits

- Hooks observe an event before all other hooks have decided. Existing hooks may reject a prompt, answer or deny permission and questions, or require Stop continuation; a reported callback can precede that rejection. A Stop that requests continuation can show Done too early, and an elicitation answered by another hook can omit ElicitationResult and leave a wait until a later decisive fact.
- A single tool failure remains Busy, and automatic retry without a final failure event stays Busy. StopFailure covers reported API turn failures, not every error or interruption.
- Interruption has no native Ready mapping, and free-text questions are not detected.

Requirements and evidence: [#92](https://github.com/a1457139709/VibeBridge/issues/92) and [#85](https://github.com/a1457139709/VibeBridge/issues/85). Protocol references: [native hooks](https://code.claude.com/docs/en/hooks), [invocation flags](https://code.claude.com/docs/en/cli-reference), [settings precedence](https://code.claude.com/docs/en/settings).
