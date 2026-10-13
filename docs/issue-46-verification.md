# Issue #46 — Navigation and settings shell

Scope: [#46](https://github.com/a1457139709/VibeBridge/issues/46), under [spec #45](https://github.com/a1457139709/VibeBridge/issues/45). Implementation started from integration commit `f324d6a` in its own worktree. Implementation: `3ccd051`; merge of integration including #48: `91a097e`; final code and acceptance coverage: `23125dc`.

The approved seams are the real Workbench service with controlled CLI processes, and the real Electron desktop with DOM/native input. No prototype code or architecture is used. All runtime tests below use real macOS PTY/process access outside the filesystem sandbox; desktop tests are recorded separately and are not claimed as CI coverage.

## Red → green record

- `npm test -- tests/navigation.test.ts`: red on missing snapshot navigation preferences (`undefined` instead of `{ visible: true, width: 212 }`); green after adding snapshot/service/SQLite persistence. The first sandboxed attempt failed on macOS process-table permissions, rather than product behavior.
- `npm run test:desktop -- --navigation`: red when collapsed navigation still occupied 112 pixels; green after complete hiding and a stationary system-bar toggle.
- Same desktop command, resize slice: red because no navigation resize edge existed; green after native pointer resize, release-only persistence, and restoration of 312px width/hidden state in a new Electron process.
- Settings slice: red when entering settings hid navigation (0px instead of 312px); green after preserving navigation and centralizing leave requests. A subsequent scroll check reproduced the Return control leaving the visible area; keeping the control sticky made it pass.
- Notices slice: red when appearance saving produced no top notice; green after routing save feedback through the shared queue. Repeating the save then reproduced two copies of the same notice; deduplication and timer restart made it pass. Native hover then reproduced expiration while hovering; pausing and resuming the remaining time made it pass.

Two test assumptions were corrected without changing product semantics: Electron native `char` input uses a single character, and a failed `addPanel` launch returns a launch result rather than emitting a Workbench `error`. Error queue tests therefore use a real settings filesystem-save failure. Save fields become disabled during saving, so the focus assertions test that the notice never receives focus and that dismissing it preserves the live terminal's focus.

## Final validation — 2026-10-12

- `npm run build` — passed. Existing Vite large-bundle advisory remains.
- `npm test` — 26 passed, 0 failed after merging #48. Includes existing #43 lifecycle tests and an added integration assertion that navigation preferences survive project creation, deletion and reopening. The deletion SQL explicitly names the workspace columns so its transaction preserves the added navigation value.
- `npm run test:desktop -- --navigation` — passed, including a second Electron launch. Covers complete hiding, unchanged toggle location, continuous native resizing and release-only persistence; settings/create/empty/project returns; native shortcut suppression during settings, dialogs and recording; retained maximized layout, run identities and actual input target; a fixed settings footer while the project list scrolls; a 760px-wide window; and Return remaining visible after scrolling settings. Also covers top notice geometry, two-second success expiration, five-second error expiration, deduplication/reset, native hover pause/resume, independently timed stacking, native dismissal without stealing terminal focus, and repeated actual settings-save failures without changing saved settings.
- `npm run test:desktop -- --notices-startup` — passed. A malformed real configuration file produces the top startup error, expires after five seconds, and reappears as an actionable failure when saving is retried. The original file remains unchanged.
- `npm run test:desktop` — passed, including the existing four-/ten-run load checks, quit cleanup and reopen round. The existing Return → shortcut test now waits for observable terminal focus after the asynchronous leave decision; its shortcut-save expectations remain unchanged for #47 to update.
- `git diff --check` — passed.

Electron logged expected errors for deliberately failed settings writes and its existing isolated-profile Shared Dictionary cache diagnostic; all final commands exited successfully. A real-window capture at `work/issue-46/navigation-settings.png` was inspected by the implementer and parent; it shows navigation/settings coexistence and the fixed footer at the narrow size. The hovered project row in that capture is not marked as the current page; settings owns `aria-current`.

## Handoff boundaries

`App.leaveSettings(action)` awaits `SettingsPageActions.requestLeave()` before changing the page or performing the original navigation. It currently prevents leaving during an in-progress save. #47 implements the specified unsaved-draft decision at this boundary; no draft-confirmation placeholder UI was added. Setup drafts remain in the application shell, and the workspace stays mounted while settings are visible.

`useNotices().report(message, kind)` is the shared notification entry point for subsequent panel-switch feedback. Navigation defaults to visible at 212px; manual width is clamped to 168–420px and stored in SQLite rather than `settings.json`.

No #46 acceptance item remains gated on human CLI observation. The overall spec's title observation, title filtering, animation experience and real-CLI restart gates belong to the subsequent tickets and have not been signed off here.
