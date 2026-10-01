# Issue tracker: GitHub

Issues and specs for this project live in GitHub Issues in `a1457139709/VibeBridge`. Use the `gh` CLI for issue operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file /path/to/body.md`. Write multiline bodies to a temporary file and pass it with `--body-file`.
- **Read an issue**: `gh issue view <number> --comments`. To inspect labels and comments as structured data, use `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`, with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file /path/to/comment.md`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`. Use the mapping in `triage-labels.md`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside a clone. When operating outside this project, pass `--repo a1457139709/VibeBridge`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create it with `gh issue create --label wayfinder:map --title "..." --body-file /path/to/map.md`.
- **Child ticket**: link an issue to the map as a GitHub sub-issue using the sub-issues API. Where sub-issues are unavailable, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`). Once claimed, assign the ticket to the driving developer.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Fetch the blocker's numeric database ID with `gh api repos/<owner>/<repo>/issues/<number> --jq .id`. The database ID differs from the issue number and `node_id`. If dependencies are unavailable, put `Blocked by: #<number>, #<number>` near the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, scoped to its sub-issues or task list. Exclude children with an assignee or an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line). First in map order wins.
- **Claim**: `gh issue edit <number> --add-assignee @me`, the session's first write.
- **Resolve**: post the answer using `gh issue comment <number> --body-file /path/to/answer.md`, close the issue, then append a context pointer (gist + link) to the map's Decisions-so-far.
