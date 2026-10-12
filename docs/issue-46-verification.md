# Issue #46 — Navigation and settings shell

Scope: [#46](https://github.com/a1457139709/VibeBridge/issues/46), under [spec #45](https://github.com/a1457139709/VibeBridge/issues/45). Implementation started from integration commit `f324d6a` in its own worktree. The approved seams are the real Workbench service with controlled CLI processes, and the real Electron desktop with DOM/native input. No prototype code or architecture is used.

## Red → green record

- `npm test -- tests/navigation.test.ts`: red on missing snapshot navigation preferences (`undefined` instead of `{ visible: true, width: 212 }`); green after adding snapshot/service/SQLite persistence. The first sandboxed attempt failed on macOS process-table permissions; meaningful PTY tests run unsandboxed.
- `npm run test:desktop -- --navigation`: red when collapsed navigation still occupied 112 pixels; green after complete hiding and a stationary system-bar toggle.
- Same desktop command, next slice: red because no navigation resize edge existed. Green after native pointer resize, release-only persistence, and restoration of 312px width/hidden state in a new Electron process.

- Same desktop command, settings slice: red when entering settings hid navigation (0px instead of 312px); green after preserving navigation and centralizing leave requests. Checks include returning to a setup draft and an empty page, project navigation, native settings shortcut toggling, suppressing other shortcuts and recorder/dialog shortcuts, retaining maximized layout and actual terminal input target, fixed footer while scrolling, and a 760px window.
- Same desktop command, notices slice: red when appearance saving produced no top notice. Added the shared renderer notice queue and routed service/startup/settings save feedback into it; remaining queue interactions are validated next.

## Validation

Final build, service suite, desktop suite and any remaining manual checks are recorded here before delivery.
