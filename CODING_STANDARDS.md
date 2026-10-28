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
