# Coding Standards

## Current design only

The code describes the **current design**: the one set by the latest spec, issue resolutions, and ADRs. When a change replaces a design, the old design leaves the codebase in the same change. History lives in issues, PRs, and git.

### Code

- Replace the old implementation outright. Update every caller to the new interface in the same change.
- Each behaviour has one code path: the current one. Names, layering, and module boundaries follow the current design, even when that means renaming or moving existing code.
- Remove anything that exists only for the old design: compatibility shims, alias exports, deprecated paths, dual reads or writes, fallback branches for inputs the current design no longer produces.

### Persisted data

- Stored formats (`settings.json`, `projects.sqlite`, …) are read in their current format only. When a format changes, the store drops the old-format data when it opens (a table, or a key in `settings.json`), keeps everything the change does not touch, and converts nothing. The PR names what users lose.
- A format stores what the current design needs. A later change drops and starts over, so a field waits for the design that uses it.
- These two rules hold while VibeBridge has no users whose data must survive an upgrade; revisit them before it does.
- How a file treats invalid content is decided per file, in its ADR or issue resolution. A file that cannot be read at all is reported clearly and left untouched.

### When decisions conflict

Specs, issue resolutions, ADRs, and these standards record decisions made at the time, and any of them may be revised. The latest decision wins. When a change contradicts an earlier document, update or remove that document in the same change, and name the conflict in the PR instead of silently following either side.

### Comments and docs

Source code carries no comments: names and structure say what code does, and a decision the code cannot show goes into `docs/adr/` or `docs/`. `npm run check:comments` enforces it against a baseline that only shrinks; `/delete-comment` is the process for what the baseline still holds. The reasoning is in `docs/adr/0010-code-carries-no-comments.md`.

README and `docs/` state what the current design is and why. Phrasings such as "formerly", "previously", "now", "no longer", or "kept for old callers" belong in the PR, not the repository.

### Scope

These rules apply to every change. Old design found outside the change under review becomes its own issue rather than growing the current change.

## Names

A name states what its code does or holds, read at the call site without opening the definition. Matching a glossary term is a start, not the test.

- A function or method is named with a verb for what it does: `follow(projectId, found)` moves a binding; `on(...)` or `handle(...)` says only that something happens.
- A callback field is named for the event it answers: `onRunExited`, not `moved` or `done`.
- A short name or abbreviation stands for exactly one thing in its scope, and that thing is what the full word would say.
- Two functions that behave differently carry different names, even in different layers: a shared name tells the reader they do the same thing.
- A lower layer names things in its own terms. `ProcessingStatus` speaks of reports and observations; dispatch is a word of the layers above it.
- When behaviour changes, its names change with it in the same change.

Review each new or changed name by reading its call site alone and asking whether it says what happens there.

## Tests

### Data

Each test creates the data it needs and cleans it up, so a clean checkout passes without artifacts left by earlier tasks. Fixtures are named by the behaviour they stand for.

### Assertions

A test confirms the program's **behaviour**: the state it ends in, the data it produces, the requests it sends. Wording is presentation and confirms nothing.

- Assert structured values: a pure function's return value, the `Workbench`'s state or `window.workbench.snapshot()`, the arguments a main-process call received.
- Logic that derives what a view shows (whether a change happened, whether saving is allowed, which problem applies) lives in a pure function beside the view, a **presentation model** that returns structured values; the component renders its result. Unit tests import it directly, from `app/renderer` as from `app/shared`.
- A failure is a discriminated union whose `kind` names it and whose fields carry its data. A mapping function turns it into a message id and values where it is shown, so derived results carry the failure rather than translated text. Across processes a failure the caller branches on is returned as such a union; a thrown error carries the `message()` envelope.
- Component tests confirm the wiring between view and program. They locate elements by role, with the accessible name from the locale: `{ name: t('localDirectory') }`, where `t` is `localize('en').t`.
- When the behaviour is that the view shows something, the test asserts which message it shows and with which values, built with `t(id, values)`.
- Localization tests confirm each language's structure, never its wording: for every language and every message id, the translation exists and uses exactly the placeholders of the English message, and an enveloped message's text equals that language's lookup of the same id. Adding a language adds no test; translation review owns the wording.

`npm run check:test-wording` enforces the locating rules against a per-file baseline that only shrinks. The reasoning is in `docs/adr/0009-tests-confirm-behaviour-not-wording.md`.

### Waits

A test waits on the **settled state** of the behaviour under test: the observable values it ends in, checked so that a state reached before the wait began still passes.

- Query the state the wait needs, e.g. send `size` to the CLI fixture and compare its reply with the terminal's current rows, rather than clearing the output and waiting for a fresh `SIZE:` line.
- Every assertion follows an `until` on its settled state. An assertion that something does not happen lives in a unit test, where the test controls input and time; tests hold no fixed waits of N milliseconds or N frames.
- Review each wait by asking whether it still passes when the event behind its state fired before the wait began, or never fires.

The layering and reasoning behind these rules are in `docs/adr/0005-tests-guarantee-behaviour-deterministically.md`.
