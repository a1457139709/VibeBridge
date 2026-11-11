## Agent skills

### Durable project knowledge

Keep README focused on setup and usage, with a brief entry point for checks; record task-specific verification results and migration history in the relevant issue or PR.
Fold reusable findings into behavior-focused tests or existing authoritative documentation, and remove superseded task-created notes and references.
Name test fixtures by behavior and have tests create and clean their own data so a clean checkout works without prior task artifacts.

### Coding standards

Before writing, changing, or reviewing code or tests, read `CODING_STANDARDS.md`.

### Prototype scope

Treat the prototype as the authority on visible UI and frontend interaction: layout, styling, copy, and interaction behavior. Production frontend code may start from the prototype's components and styles, wired to the data interfaces the specification defines. Deviate from the prototype only where a real implementation constraint requires it, such as paging a long list, and record each deviation in the spec or ticket.

Derive backend behavior, process management, communication, state ownership, data models, and lifecycle rules from the approved specification, issue resolutions, and architecture decisions. Prototype code and behavior are not evidence for these.

### Issue tracker

Issues and specs are tracked in GitHub Issues. Before ticket operations, read `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles use their default label names. Before triage, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs. Before exploring the codebase, read `docs/agents/domain.md`.
