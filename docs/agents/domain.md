# Domain Docs

How the engineering skills consume this project's domain documentation.

## Layout

This is a single-context project: `CONTEXT.md` at the root for the domain glossary, and `docs/adr/` for architecture decision records.
The current glossary lives at `plans/CONTEXT.md`; use it while root `CONTEXT.md` is absent.

## Before exploring, read these

- Read root `CONTEXT.md` when it exists; otherwise read `plans/CONTEXT.md`.
- Read ADRs in `docs/adr/` that concern the area being explored.

If these documents are absent, proceed silently. The `/domain-modeling` skill creates domain docs lazily when terms or decisions are resolved.

## File structure

```text
/
├── CONTEXT.md       # Root glossary when created
├── docs/
│   └── adr/         # Architecture decision records when created
└── plans/
    └── CONTEXT.md   # Current glossary; fallback while root glossary is absent
```

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term defined in the active glossary.
If a needed concept is missing, reconsider invented terminology or note the real gap for `/domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, name that ADR and explain why the decision should be reconsidered.
