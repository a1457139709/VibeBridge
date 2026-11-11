## Agent skills

### Durable project knowledge

Keep README focused on setup and usage, with a brief entry point for checks; record task-specific verification results and migration history in the relevant issue or PR.
Fold reusable findings into behavior-focused tests or existing authoritative documentation, and remove superseded task-created notes and references.
Name test fixtures by behavior and have tests create and clean their own data so a clean checkout works without prior task artifacts.

### Coding standards

Before writing, changing, or reviewing code or tests, read `CODING_STANDARDS.md`.

### Prototypes

Prototypes are throwaway: take only their visible UI and interactions. Write production code fresh from the spec, issue resolutions, and ADRs.

### Issue tracker

Issues and specs are tracked in GitHub Issues. Before ticket operations, read `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles use their default label names. Before triage, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs. Before exploring the codebase, read `docs/agents/domain.md`.
