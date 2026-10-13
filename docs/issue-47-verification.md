# Issue #47 — Settings drafts and guarded saves

Scope: [#47](https://github.com/a1457139709/VibeBridge/issues/47), under [spec #45](https://github.com/a1457139709/VibeBridge/issues/45). Started from integration `20779b7` in an isolated checkout. Implementation commits: `2b8b430` and `05e2bd0`. Latest integration through `c916a56` is included via `47c697e` and `a317351`; this preserves #43 lifecycle protections, #48 project management, and #50 panel behavior.

The preapproved seams are the public Workbench service with controlled CLI processes and real Electron DOM/native input. No prototype code, new test framework, private component state or private xterm API is used. Runtime checks used real macOS PTY/process access outside the filesystem sandbox. Desktop results are separate from CI evidence.

## Red → green record

- `npm test -- tests/settings-drafts.test.ts`: legacy settings initially had no `closePanel` default. Filling missing actions made the migration test green. A deliberately introduced default collision remains usable at startup; strict saves reject it; quit preserves the original file instead of failing or rewriting unrelated settings. Correcting the binding persists through reopen.
- Same service command: an empty command initially returned the generic damaged-configuration message. It now returns `启动命令不能为空` with the Agent field path. Partial category saves preserve other effective categories; malformed/conflicting shortcuts and real filesystem write failures leave the snapshot unchanged.
- A subsequent service red caught a preexisting duplicate being excused because a newly missing action joined the same conflict group. Migration now permits only collisions introduced by the missing defaults; explicitly conflicting old bindings retain the unreadable-file protection.
- `npm run test:desktop -- --settings-drafts`: the recorder initially changed effective bindings immediately (`Command+K` instead of the saved `Command+]`). Draft-only recording and explicit category save made it green.
- The next desktop slice timed out waiting for the empty-field error/focus. Per-field validation and the leave decision dialog made independent category drafts, partial saves, invalid-save focus, cancel and discard green.
- The conflict slice failed because conflicting draft inputs had no highlight. It now exercises one four-action group, a different second group, a system-copy conflict, matching/different computed colors, conflict names, rejected save, preserved draft, restore-default draft and discard-to-saved behavior. Recording the settings action never navigates.
- The scroll slice failed because the save button was below the content. A fixed shell/category header and independently scrolling category body made native wheel scrolling preserve title, Return, category navigation and Save positions. Switching categories returns the body to its top.
- The close slice timed out because native Command+Shift+W did not close the selected panel. Routing the action through the existing close operation made split selection, maximized target, surviving original runs, actual process exit and last-panel empty-project behavior green. Settings suppresses this shortcut.
- `npm run test:desktop -- --settings-migration`: saving appearance against a migrated conflict initially stayed on appearance. It now locates the conflicting shortcut category. Save-all repairs shortcut bindings before saving the other dirty categories; quit with an unsaved Agent draft retains the saved file and exactly one existing native quit confirmation.
- Final write-failure visual inspection exposed Electron's transport prefix beside Save. An exact visible-text assertion reproduced it; the header now shows only `配置保存失败`, matching the shared notice.

## Required integration repair

The original `--navigation` sequence repeatedly failed after returning from settings in a 760px window with 312px navigation. The window, web contents and document all had native focus; settings was closed, but the selected panel had incorrectly entered tiny mode. Its computed cell width was about 43.238px while the rendered terminal cursor cell was about 7.84px.

The old measurement divided rendered grid pixels by live terminal columns/rows. Fit updates these on different frames, so the quotient can temporarily combine old pixels and new dimensions, hide a usable panel and prevent terminal focus. `terminalCellSize` now measures the rendered row's font, letter spacing and line height together, independent of grid dimensions. No terminal lifecycle or layout persistence rule changed.

The first repair used the CSS `font` shorthand; the existing panel-bound test caught a fallback height of 32.148px for two rows plus border. Reading the computed font properties explicitly corrected this. The final `--panels` run measured 7.824 × 17.000px cells and passed normal/nested bounds, tiny presentation, undersized-window rules, live runs, previews, cancellation and reopen. The original navigation sequence then passed. Temporary diagnostics were removed.

## Validation — 2026-10-12

- `npm run build` — passed; existing Vite large-bundle advisory remains.
- `npm test` — 29 passed, 0 failed, including all existing process cleanup and damaged-data protections. The final focused settings service run also passed all 3 tests, including malformed binding rejection.
- `npm run test:desktop -- --settings-drafts` — passed. Includes all three independent drafts, manual partial saves, grouped conflicts, field validation/focus, fixed scrolling, and every original settings leave entrance: Return, settings entry, native settings shortcut, project and create. Cancel/invalid save preserve the original page. A real filesystem write failure preserves effective settings, reports no success and locates the failed category. A later successful save executes the original project action only after all dirty categories save; discard executes the create action. Theme remains unchanged until restart, existing layouts/runs remain unchanged, and command availability is checked only on request.
- `npm run test:desktop -- --settings-migration` — passed, including migrated conflict presentation, correction, save-all and dirty-draft quit persistence.
- `npm run test:desktop` — passed, including native input, manual shortcut-save/default-reset expectations, saving a checked-but-unavailable command without restarting existing runs, four-/ten-run load checks, cleanup and actual reopen.
- `npm run test:desktop -- --navigation` — passed after the cell measurement repair, including notice timing/hover/dismissal, native input following settings return, navigation persistence and actual reopen.
- `npm run test:desktop -- --panels` — passed after the repair, including its actual reopen round.
- `npm run test:desktop -- --notices-startup` — passed; malformed configuration remains preserved after failed saves and quit.
- `git diff --check` — passed.

Deliberate filesystem failures and rejected migration-conflict saves log expected IPC errors. Electron also emits its existing isolated-profile Shared Dictionary diagnostic; final commands exited successfully. A real-window screenshot at `outputs/issue-47-settings.png` shows fixed controls, the save failure reason and the preserved draft; it is a task artifact, not a committed product file.

## Handoff

`SettingsPageActions.requestLeave(): Promise<boolean>` remains the single leave decision. It resolves false for cancel, validation failures or write failures and true only for clean settings, successful save-all or discard. `App.navigate` performs the original action only after true. #49's panel locator must continue through this same boundary; its cross-feature desktop checks are owned by #49 after integration.

No #47 item requires a separate human CLI observation gate. The overall spec's subjective animation and real-CLI title/restart observation gates remain in the parent acceptance guide and are not claimed here.
