## Agent skills

### Durable project knowledge

Keep README focused on setup and usage, with a brief entry point for checks; record task-specific verification results and migration history in the relevant issue or PR.
Fold reusable findings into behavior-focused tests or existing authoritative documentation, and remove superseded task-created notes and references.
Name test fixtures by behavior and have tests create and clean their own data so a clean checkout works without prior task artifacts.

### Prototype scope

Use prototypes only to imitate their visible UI and frontend interactions. Implement production code independently from the approved specification, issue resolutions, and architecture decisions.

Never reuse, copy, adapt, or import prototype code, including frontend code. Never reuse prototype software design, architecture, component structure, data models, or implementation patterns. Prototype behavior and code are not evidence for backend behavior, process management, communication, state ownership, or lifecycle rules.

### Issue tracker

Issues and specs are tracked in GitHub Issues. Before ticket operations, read `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles use their default label names. Before triage, read `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs. Before exploring the codebase, read `docs/agents/domain.md`.
