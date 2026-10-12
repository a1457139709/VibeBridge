# Issue #49 — raw terminal-title observation and panel location

Implementation commits: `ec60bb8` (run-owned PTY title observation) and `b978c26` (shared raw-title display, navigation, focus and viewing mode). This is the unfiltered observation release. Issue #49 remains open until the user confirms real CLI observations; #51 must remain blocked.

## Public seams and test progression

The approved seams are the public Workbench service with real controlled CLI processes and the real Electron desktop with DOM/native input. No private parser/React state access, internal collaborator replacements, real LLM conversations or prototype implementation were used.

The service tracer first failed because OSC titles were absent from run snapshots. It now recognizes OSC 0/2 across output fragments, preserves exact raw text and original terminal output, handles consecutive/empty titles, ignores terminal body text and other OSC commands, isolates running instances and resets on restart/reopen. The delayed-start case suspends the actual terminal manager: a `starting` run is later replaced by its genuine start and accepts its own title without affecting another run. An old CLI emits a final title during controlled termination before replacement; it cannot supply the replacement run's title.

Desktop red/green progression:

- No navigation entries → creation-ordered entries sharing the panel's raw title and same-selected native input refocus.
- Cross-project locator lost source maximize mode → shell-owned per-project selected/maximized state; source split/maximize mode controls the locator destination without rewriting layouts or runs.
- Reduced-motion switch had no success feedback → direct switch with the exact shared title and retained terminal focus; normal browser animation renders outgoing/incoming 100 ms halves sequentially.
- Success notice CSS collapsed consecutive spaces (`normal` versus expected `pre-wrap`) → preserve whitespace in notice text. Panel and navigation titles preserve whitespace with `white-space: pre`, single-line clipping/ellipsis and full tooltips.

An extended desktop run exposed a fixture-only long Unicode input timeout: decoding each raw stdin Buffer independently could split an emoji. The controlled CLI now decodes stdin with UTF-8 streaming semantics; the long Unicode service assertion and subsequent extended desktop/reopen runs passed.

## Automated commands

Commands run in the isolated issue-49 checkout. Native/PTY commands require the authorized unsandboxed environment because process-table inspection and Electron/native input are unavailable in the filesystem sandbox. They are local checks, not claims of CI coverage.

- `npm run build` — passed (TypeScript and production bundles). Vite reports its existing bundle-size warning.
- `npm test -- tests/titles.test.ts` — 4/4 passed, including exact long Unicode title transport.
- `npm test` — 30/30 passed before #47; final combined run after merging integration `ad0c9c7` passed 33/33 (34.27 s).
- `npm run test:desktop -- --titles` — passed, including actual quit/reopen. Checks exact long Unicode titles, fixed slot geometry, one-line ellipsis and permanent header actions; native swap/ratio changes preserve creation order; add/close/zero lists and independent expansion stay synchronized; project heading switches retain per-project viewing state.
- `VIBEBRIDGE_TEST_SCREENSHOT=outputs/issue-49-titles.png npm run test:desktop -- --titles` — final integrated run passed. Panel locators from settings passed clean leave, cancel, invalid-command rejection, real file-write failure, discard and successful save; native input reached only the accepted target. The screenshot was viewed and preserved by the coordinator at `outputs/spec-45-evidence/session-titles.png`.
- `npm run test:desktop -- --panels` — passed, including real quit/reopen; measured cell bounds/tiny display, resize, native drag preview/cancellation/commit, stable live input and saved arrangement regression.
- `npm run test:desktop -- --navigation` — passed, including real quit/reopen and existing guarded settings paths.

Desktop harnesses remove their temporary data directory and assert terminated run PIDs after closing the application. Transient Chromium Shared Dictionary cache-directory warnings did not fail the checks. The deliberate real settings-write failures report `EISDIR`; both guarded-locator and navigation harnesses still exit successfully after asserting retained drafts/effective state.

## Human gate

See [the human observation guide](spec-45-human-acceptance.md). Claude Code 2.1.296, Codex CLI 0.162.1 and pi 0.84.4 are version checks only. No real CLI conversation, rename, busy/idle or disabled-title observation has been claimed by this implementation. The user must confirm these observations and the smoothness/reduced-motion experience. Codex native limitations must be recorded without adding hooks. No title filtering, directory stripping, state-symbol removal, known-format recognition, CLI configuration/argument changes or session-file reads have been added.
