---
name: delete-comment
description: Classify every code comment in a scope, delete it, and move what it recorded to the right place.
disable-model-invocation: true
---

Source code carries no comments (`docs/adr/0010-code-carries-no-comments.md`). This skill clears the comments `scripts/comment-baseline.json` still allows, or those in the path the user names. Read `CODING_STANDARDS.md` and `docs/agents/domain.md` first.

## 1. Collect

The scope is the path the user names, else every file in `scripts/comment-baseline.json`. `npm run check:comments` lists each file with comments and their line numbers. Read each comment with the code around it.

Done when you hold a list of every comment in scope, each with its file and line.

## 2. Classify

Give each comment exactly one category:

- **Tautology**: restates what the code already shows: its name, signature, types or body.
- **Stale**: describes code, names or behaviour the repository no longer has. Check each name and path it mentions.
- **Excuse**: justifies a shortcut (a hard-coded copy of a value, a swallowed error, a missing pagination, a test that depends on test order) so the shortcut survives and gets copied.
- **Decision record**: an important choice the code cannot show: an external system's behaviour, a race, a security or privacy boundary, a platform quirk, a reason an obvious alternative fails.

A decision already written in `docs/adr/` or `docs/` (the `docs/<agent>-status.md` integration docs, `docs/processing-status.md`) counts as recorded; note where.

Done when every comment carries a category, and every decision record names its destination.

## 3. Act

- **Tautology, Stale**: delete.
- **Excuse**: delete, and file one GitHub issue per shortcut (`docs/agents/issue-tracker.md`, label `needs-triage`) naming the files, the shortcut, and the fix it needs.
- **Decision record**: add it to the ADR of its area, or a new ADR, written as the existing ADRs are (same language and layout: heading, decision, `## Considered Options`, `## Consequences`), each decision naming the file it constrains; then delete the comment. A decision already recorded is simply deleted.

Delete whole comment lines, so no blank line or empty `{}` JSX expression is left behind, then `npx prettier --write` the changed files.

Done when no comment in scope remains and each excuse has an issue number.

## 4. Ratchet and verify

Run `npm run check:comments -- --update` to lower the baseline, then `npm run check`. Count the lines shed with `git diff --shortstat`.

Done when `npm run check` passes and the baseline holds only files still out of scope.

## 5. Report

Report the count per category, the ADRs written or extended, the issues filed, and the lines shed.
