# Domain Docs

How the engineering skills consume this project's domain documentation.

## Layout

This is a single-context project: `plans/GLOSSARY.md` for the domain glossary, and `docs/adr/` for architecture decision records.

## Before exploring, read these

- Read `plans/GLOSSARY.md`.
- Read ADRs in `docs/adr/` that concern the area being explored.

If these documents are absent, proceed silently. The `/domain-modeling` skill creates domain docs lazily when terms or decisions are resolved.

## File structure

```text
/
├── docs/
│   └── adr/         # Architecture decision records when created
└── plans/
    └── GLOSSARY.md  # Domain glossary
```

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term defined in the active glossary.
If a needed concept is missing, reconsider invented terminology or note the real gap for `/domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, name that ADR and explain why the decision should be reconsidered.
