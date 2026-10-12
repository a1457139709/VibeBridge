# Issue #48 verification

Implementation is on `implement/spec-45-48`, based on integration branch `implement/spec-45` (`f324d6a`). The approved test boundaries are the public Workbench service with real controlled PTYs, and the real Electron renderer/native input. No prototype implementation was reused.

## Service checks

`npm test -- tests/project-management.test.ts` passed 9 project-management scenarios:

- Rename, unchanged save and a symlink to the same real directory retain run identity, panel configuration and layout; empty/control-character names and invalid directories reject without mutation.
- Changing directory without restart keeps the old run's actual cwd; the controlled CLI reports cwd over PTY. Project switching does not launch it again. New panels use the saved directory, and unvisited projects defer restart until first activation.
- Restart preserves panel identities, layout ratios and ordering; replaces run identities; cleans the old CLI and detached child; starts in the new cwd; leaves another project's run unchanged. A later natural exit still removes its own panel.
- Delete cleans the targeted CLI and an orphan child, preserves a file representing CLI history, persists removal across reopen, selects next/previous neighbours and then no project, and permits fresh configuration when re-adding the directory.
- Partial launch failure returns one result per panel without reverting the saved directory. Zero-panel restart keeps the project empty.
- A real SQLite write lock rejects edit before changing or stopping runs. A delete write failure leaves all project/panel/layout records and active selection intact while correctly showing already stopped runs; reopening verifies the retained records through Workbench.
- A terminal-manager crash is reported and prevents deletion from claiming unconfirmed cleanup succeeded.
- A start-response timeout is reported per panel as uncertain, retains the saved directory, and remains part of deletion/close cleanup. A subsequent delete timeout leaves records intact; after SIGCONT the delayed start is stopped and its panel is retained.
- A real terminal-manager SIGSTOP causes a bounded stop timeout. The result says the edit was saved and restart was not performed; late cleanup after SIGCONT retains the panels.

PTY/process tests require execution outside the filesystem sandbox because `/bin/ps` is restricted there. An initial sandboxed attempt failed on process inspection; this was an environment failure, not a pass. Unsandboxed runs use isolated task directories and clean their managed processes.

## Desktop and final checks

`npm run build` passed (TypeScript, Electron bundles and Vite). Vite reports the existing >500 kB renderer bundle advisory.

`npm test` passed 24/24 service tests in the final run (34 seconds), including all 9 new project-management scenarios.

`npm run test:desktop -- --project-management` passed in real Electron on macOS, outside the sandbox. It covers the original user paths: create a live project; open the overflow menu; unchanged save; native right-click; rename; change and revert to a symlink for the same directory; cancel all edits; duplicate-directory open; change without restart; restart with per-panel results; cancel deletion; confirm deletion; and the final empty workbench. Service snapshots and native input verify actual outcomes. No claim of CI GUI coverage is made.

The desktop tracer initially failed at the missing menu (red). After implementation an activation timing wait in the harness was corrected, then the full sequence passed. Chromium emitted an isolated temporary cache warning; it did not prevent the desktop checks.

Implementation commit: `92cc86e` (`feat: edit and delete projects with controlled run cleanup`).

## User acceptance still required

The user must confirm actual Claude Code, Codex CLI and pi startup after changing the project directory, and manually restoring an old session inside each CLI. Controlled test programs cannot stand in for those experiences. No automatic resume, injected conversation, CLI configuration change or session migration is implemented.
