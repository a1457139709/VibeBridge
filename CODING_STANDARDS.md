# Coding Standards

## Current design only

The code describes the **current design**: the one set by the latest spec, issue resolutions, and ADRs. When a change replaces a design, the old design leaves the codebase in the same change. History lives in issues, PRs, and git.

### Code

- Replace the old implementation outright. Update every caller to the new interface in the same change.
- Each behaviour has one code path: the current one. Names, layering, and module boundaries follow the current design, even when that means renaming or moving existing code.
- Remove anything that exists only for the old design: compatibility shims, alias exports, deprecated paths, dual reads or writes, fallback branches for inputs the current design no longer produces.

### Persisted data

- `settings.json`, `projects.sqlite`, and every other stored format are read in their current format only.
- Input in any other format is an error: report it clearly and leave the original file untouched. Write no migration code.

### Tests

Tests describe current behaviour, and they also hold the product's robustness lessons. Before changing or removing a test, understand the failure it guards against, then classify it with one question: **could that failure still happen in the current design?**

- **Yes — robustness test.** Rewrite it against the current design and keep the scenario. Its name states the failure it guards against (for example, overlapping compactions, retry backoff cancelled, terminal host failing during launch).
- **No — old-design test.** Delete it. Typical cases: it asserts that an old event, field, format, or interface is still accepted.
- **Unclear — keep and rewrite.** Deletion needs a named reason why the current design makes the failure impossible; keeping needs none.

Rewrite fixtures to the current format.

The PR description lists every deleted test with that one-line reason.

### Comments and docs

Code comments, README, and `docs/` state what the current design is and why. Phrasings such as "formerly", "previously", "now", "no longer", or "kept for old callers" belong in the PR, not the repository.

### Scope

These rules apply to every change. Old design found outside the change under review becomes its own issue rather than growing the current change.
