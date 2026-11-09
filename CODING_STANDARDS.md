# Coding Standards

## Current design only

The code describes the **current design**: the one set by the latest spec, issue resolutions, and ADRs. When a change replaces a design, the old design leaves the codebase in the same change. History lives in issues, PRs, and git.

### Code

- Replace the old implementation outright. Update every caller to the new interface in the same change.
- Each behaviour has one code path: the current one. Names, layering, and module boundaries follow the current design, even when that means renaming or moving existing code.
- Remove anything that exists only for the old design: compatibility shims, alias exports, deprecated paths, dual reads or writes, fallback branches for inputs the current design no longer produces.

### Persisted data

- Stored formats (`settings.json`, `projects.sqlite`, …) are read in their current format only. Write no migration code and no compatibility for older formats.
- How a file treats invalid content is decided per file, in its ADR or issue resolution. A file that cannot be read at all is reported clearly and left untouched.

### When decisions conflict

Specs, issue resolutions, ADRs, and these standards record decisions made at the time, and any of them may be revised. The latest decision wins. When a change contradicts an earlier document, update or remove that document in the same change, and name the conflict in the PR instead of silently following either side.

### Comments and docs

Code comments, README, and `docs/` state what the current design is and why. Phrasings such as "formerly", "previously", "now", "no longer", or "kept for old callers" belong in the PR, not the repository.

### Scope

These rules apply to every change. Old design found outside the change under review becomes its own issue rather than growing the current change.

## Tests

### Waits

A test waits on the **settled state** of the behaviour under test: the observable values it ends in, checked so that a state reached before the wait began still passes.

- Query the state the wait needs, e.g. send `size` to the CLI fixture and compare its reply with the terminal's current rows, rather than clearing the output and waiting for a fresh `SIZE:` line.
- Every assertion follows an `until` on its settled state. An assertion that something does not happen lives in a unit test, where the test controls input and time; tests hold no fixed waits of N milliseconds or N frames.
- Review each wait by asking whether it still passes when the event behind its state fired before the wait began, or never fires.

The layering and reasoning behind these rules are in `docs/adr/0005-tests-guarantee-behaviour-deterministically.md`.
