# Pull request diffs and PR ↔ issue linkage on GitHub

Research for the GitHub sidebar's pull request view. It covers two topics: how to fetch and render a PR diff, and how accurately PRs and issues can be linked. This note records facts only and does not choose an approach.

Sources were read on 2026-11-07: GitHub Docs (REST API version `2026-03-10`), the live GraphQL schema (introspection), and the `gh` source at tag `v2.100.0` (`45437bc`). Live checks used `gh` 2.100.0, read-only, against `a1457139709/VibeBridge`. Public repos (`cli/cli`, `microsoft/vscode`) were used where VibeBridge had no example. Results marked **Observed** come from those checks and are not documented behaviour.

## A. Diff

### A1. How `gh pr diff` fetches, and limits

- `gh pr diff` sends `GET /repos/{o}/{r}/pulls/{n}` with `Accept: application/vnd.github.v3.diff`. With `--patch` it sends `application/vnd.github.v3.patch`. Any status other than 200 becomes an error. There is no fallback to `/files` or to git [gh-diff].
  - `--name-only` and `--exclude` are applied on the client to the full diff that was downloaded, so they hit the same limit [gh-diff].
  - The output is coloured red and green and terminal escape sequences are neutralised. There is no syntax highlighting [gh-diff].
  - cli/cli#10712 (open) asks for `--name-only` to use `/files` instead. A maintainer confirmed the current behaviour there [gh-10712].
- Documented diff limits for "commits, pull requests, and compare views" [repo-limits]:
  - A PR's total diff can be at most 20,000 loadable lines or 1 MB of raw diff.
  - A single file's diff can be at most 20,000 lines or 500 KB. 400 lines and 20 KB load automatically.
  - At most **300 files** per diff, and at most 25 renderable files such as images or PDFs.
- The REST page for the diff media type lists `406 - Unacceptable` without explaining it [rest-pulls]. **Observed:** `microsoft/vscode#346619` (710 files) returns this for both `.diff` and `.patch`:
  ```
  HTTP/2.0 406 Not Acceptable
  {"message":"Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API or locally cloning the repository instead.",
   "errors":[{"resource":"PullRequest","field":"diff","code":"too_large"}],"status":"406"}
  ```
  `gh` prints `could not find pull request diff: HTTP 406: …` and exits 1. The line-limit variant reads `the diff exceeded the maximum number of lines (20000)` [gh-10712]. Clients can recognise both by `errors[].code == "too_large"`.
- `GET /pulls/{n}/files` [rest-pulls]:
  - "Responses include a maximum of 3000 files". The default page size is 30 and `per_page` is at most 100.
  - Each item has `filename`, `status` (`added|removed|modified|renamed|copied|changed|unchanged`), `additions`, `deletions`, `changes`, `patch`, `previous_filename`, `sha`, `blob_url`, `raw_url` and `contents_url`.
  - `patch` is optional, and the page does not say when it is omitted.
- **Observed** for `/files`:
  - On the 710-file PR, all 710 files came back, even though the raw diff was refused.
  - `patch` was absent for binary files (`removed …jpg`, `changes=0`) and for pure renames (27 renamed files with `changes=0`).
  - A user in [gh-10712] reports that `/files` "silently" lists incomplete results on some very large PRs. This is not verified.
- Related documented limits:
  - `GET /commits/{sha}` paginates files beyond 300, up to 3000. Its diff and patch media types state "Larger diffs may time out and return a 5xx", and binary files have no `patch` [rest-commits].
  - Compare (`/compare/{base}...{head}`) shows files only on the first page, "up to 300 changed files" [rest-commits].
  - GraphQL `PullRequest.files` returns only `path`, `additions`, `deletions`, `changeType` and `viewerViewedState`. It has no patch text [gql-schema].

### A2. What rendering the API gives you

- The API returns plain git output. **Observed** in raw `.diff`:
  - Renames are already detected: `similarity index 65%`, `rename from`/`rename to`.
  - Binary files appear as `Binary files a/x and /dev/null differ`.
  - Each file has `index <sha>..<sha> <mode>`, and new or deleted files show their mode.
- These are all rendering in the GitHub web UI that the client would have to build itself [branches-ref], [review-howto], [gen-files]:
  - Unified or split view, and hiding whitespace ("ignore whitespace changes" is a UI option; the PR diff endpoint documents no whitespace parameter).
  - Rich diff and source diff.
  - Syntax highlighting.
  - "Viewed" checkboxes.
  - Collapsing generated files. GitHub hides paths marked `linguist-generated` in `.gitattributes` "by default in diffs". The API returns no such flag, so a client would have to read `.gitattributes` and Linguist's rules itself.
  - Truncating per file at 400 lines or 20 KB.

### A3. Inline review comments

- REST `GET /pulls/{n}/comments` returns review comments, described as "comments made on a portion of the unified diff" [rest-review-comments]. Each comment has:
  - Location: `path`, `line`, `original_line`, `start_line`, `original_start_line`, `side`/`start_side` (`LEFT`|`RIGHT`) and `subject_type` (`line`|`file`).
  - Context: `diff_hunk`, `commit_id`, `original_commit_id`, `in_reply_to_id` and `pull_request_review_id`.
  - `position` and `original_position` are "closing down". `line` is a file line number, not a position in the diff, and `side` is `LEFT` for deletions and `RIGHT` for additions or context.
  - REST has **no** resolved flag.
- GraphQL `PullRequestReviewThread` has [gql-schema]:
  - `path`, `line`, `originalLine`, `startLine`, `originalStartLine`, `diffSide`, `startDiffSide`, `subjectType`, `isResolved`, `resolvedBy`, `isOutdated` and `isCollapsed`.
  - `comments`, where each comment has `diffHunk`, `line`, `originalLine`, `outdated`, `commit`, `originalCommit` and `replyTo`.
  - `position` and `originalPosition` on comments are deprecated.
- **Observed** on `cli/cli#14952`:
  - On outdated threads `line`/`startLine` are `null` while `originalLine` is kept (`isOutdated: true`).
  - On current threads `line` gives the line on the current head, and `diffSide` gives the side.
  - REST returns the same values. For an outdated comment, `line: null` is the only sign in REST.
- Conclusion (High): GraphQL `reviewThreads` provides enough to place current threads on a diff the client renders, using `path` + `diffSide` + `line` (with `startLine` for ranges), and to show resolved and outdated state. Outdated threads need either their own `diffHunk`, or `originalLine` against `originalCommit`.

### A4. Diff base, and per-commit diffs

- Docs: "Pull requests on GitHub show a three-dot diff", which runs from the merge base to the head [branches-ref].
- **Observed:** for `cli/cli#13450` (trunk had moved ahead by 1,306 commits), the `gh pr diff` output was **byte-identical** to `GET /compare/{merge_base}...{head}` with the diff media type.
  - The PR's `base.sha`/`baseRefOid` (`81ed6d4`) was neither the merge base (`9b505c3`) nor the current tip of trunk. Clients should not use it as the diff's left side.
- Per-commit diffs:
  - `GET /repos/{o}/{r}/commits/{sha}` takes `Accept: application/vnd.github.diff` or `.patch` [rest-commits].
  - The commit list comes from `GET /pulls/{n}/commits`, which returns at most 250 commits, or GraphQL `PullRequest.commits` [rest-pulls].
  - **Observed:** `gh pr diff --patch` returns an mbox `format-patch` series with one `From <sha>` / `[PATCH k/N]` entry per commit.
  - A range of commits can be fetched with `/compare/{a}...{b}`.

## B. PR ↔ issue linkage

### B1. What populates `closingIssuesReferences`

- GraphQL: `PullRequest.closingIssuesReferences(userLinkedOnly, excludeUserLinked, orderBy, …)` — "List of issues that may be closed by this pull request". It includes both keyword links and manual links, and the two arguments separate them [gql-schema]. `gh pr view --json closingIssuesReferences` exposes the same field. REST has **no** equivalent field. The search qualifier `linked:pr|issue` only filters [search-syntax].
- Docs [linking]:
  - Keyword: the link is made through "a supported keyword in the pull request description".
  - Keywords are `close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved`. "The keywords can be followed by colons or in uppercase" (`Closes: #10`, `CLOSES #10`).
  - Manual: through the PR's or the issue's **Development** sidebar, by anyone with write access, for up to 10 issues per PR. From the PR sidebar the issue must be in the same repository. From the issue sidebar the PR may be in a different repository.
  - Commit messages: "You can also use closing keywords in a commit message. The issue will be closed when you merge the commit into the default branch, **but the pull request that contains the commit will not be listed as a linked pull request**."
  - The PR title is not mentioned anywhere as a source.
- **Observed** in VibeBridge (39 PRs checked):
  - Every PR with a body keyword targeting `main` listed exactly those issues.
  - `#133` has `Closes #131` only in a commit message, and its `closingIssuesReferences` is empty. Issue #131 was closed by a commit (`ClosedEvent.closer` is a `Commit`), and its `closedByPullRequestsReferences` is empty.
  - Manual links: `cli/cli#227` appears under both the default call and `userLinkedOnly:true` for issue #228.

### B2. Only when the PR targets the default branch

- Quote [linking]: "The special keywords in a pull request description are interpreted only when the pull request targets the repository's *default* branch. If the pull request targets *any other branch*, then these keywords are ignored, no links are created, and merging the PR has no effect on the issues."
- **Observed:** VibeBridge `#116` (base `claude/issue-113-agent-status-adapters`, body `Closes #115.`) has `closingIssuesReferences = []`. The timeline of issue #115 shows only a `CrossReferencedEvent` from #116. #115 was later closed by `#117`, which targeted `main`.
- The docs do not say whether a PR that is later retargeted to the default branch gets the link (for example a stacked PR after its parent merges). This is not verified.

### B3. Cross-repo references, edits, closed and merged PRs

- Cross-repo keyword syntax is documented: `Fixes octo-org/octo-repo#100` [linking]. No live cross-repo example was found among 300 recent merged PRs of three public repos, so this is **not verified**.
- Editing the keyword away: "To unlink an issue that you linked using a keyword, you must edit the pull request description to remove the keyword." "Only manually linked pull requests can be manually unlinked." [linking]. This implies the field follows the current body. It was **not verified** live, because that needs a write.
- **Observed:**
  - Links stay after the state changes. Merged PRs keep their `closingIssuesReferences`.
  - Closed-unmerged `#107` still lists `[103]`.
  - Open `cli/cli#14259` still lists `#14134` after that issue was closed.

### B4. Mentions without a keyword

- GraphQL `CrossReferencedEvent` represents "a mention made by one issue or pull request to another". It has `source`, `target`, `isCrossRepository`, `referencedAt` and `willCloseTarget` ("Checks if the target will be closed when the source is merged") [gql-schema].
- A commit-message mention appears as `ReferencedEvent` (REST `referenced`) [event-types].
- **Observed:** `willCloseTarget` is evaluated *now*, not when the reference was made.
  - It is `true` only for open closing PRs pointing at an open issue (`cli/cli#13758` and `#13788` → `#13546`).
  - It is `false` in these cases:
    - a merged closing PR (`#117`/`#109` → their issues)
    - a closed PR
    - an issue that is already closed (`#14259` → `#14134`)
    - a PR to a non-default branch (`#116`)
  - So it cannot tell historical closing links apart from plain mentions.
- `ConnectedEvent`/`DisconnectedEvent` ("linked to/unlinked from another issue or pull request", with a link to the linking docs) record **manual** links only. **Observed:** `cli/cli#228` has `ConnectedEvent(subject: PR #227)`, and keyword links produced none.
- In REST, the `connected` timeline event has no subject (only `actor`, `commit_id`, …). The `cross-referenced` event has `source.issue` but **no** `willCloseTarget` [event-types]; **observed**.

### B5. From an issue to its PRs

- GraphQL `Issue.closedByPullRequestsReferences(includeClosedPrs=false, orderByState, userLinkedOnly, excludeUserLinked, …)` is the reverse of `closingIssuesReferences` [gql-schema]. Its description says "open pull requests".
- **Observed:** by default it returns **open and merged** PRs. It leaves out closed-unmerged PRs unless `includeClosedPrs:true` is set:
  - Issue #103 by default gives `#109:MERGED`. With `includeClosedPrs` it gives `#107:CLOSED, #109:MERGED`.
  - It includes manual links (`cli/cli#228` → `#227`). It leaves out commit-only closes (#131 → `[]`) and non-default-branch PRs (#115 → only `#117`).
- To catch every mention, including PRs to non-default branches and mentions without keywords, add timeline `CROSS_REFERENCED_EVENT`s whose `source` is a `PullRequest`. `CONNECTED_EVENT`/`DISCONNECTED_EVENT` give the history of manual links. `ClosedEvent.closer` (a `PullRequest` or a `Commit`) says what actually closed the issue.

## Confidence

| Claim | Confidence |
| --- | --- |
| `gh pr diff` = one REST call with the diff media type, no fallback | High (source) |
| 300-file / 20k-line / 1 MB limits, 406 `too_large` | High (docs + observed) |
| `/files` up to 3000; `patch` missing for binary files and pure renames | High for the cap (docs); Medium for when `patch` is omitted (observed only) |
| Raw diff includes rename detection; everything else is UI | High |
| GraphQL threads are enough for placement and resolved/outdated state | High |
| PR diff = merge-base three-dot | High (docs + byte-identical observation) |
| Body keywords + manual links feed `closingIssuesReferences`; commit keywords and titles do not | High (docs + observed); for titles, Medium (absence in the docs) |
| Default-branch-only keyword links | High (quote + observed) |
| Field updates when the keyword is edited away | Medium (implied by docs, not tested) |
| Cross-repo keyword links | Medium (documented, not observed) |
| `willCloseTarget` reflects current state | Medium-High (observed on 6+ cases, undocumented) |
| `closedByPullRequestsReferences` default includes merged PRs | Medium-High (observed, contradicts the description wording) |

## Sources

- [gh-diff] `pkg/cmd/pr/diff/diff.go` at v2.100.0: https://github.com/cli/cli/blob/v2.100.0/pkg/cmd/pr/diff/diff.go
- [gh-10712] cli/cli#10712: https://github.com/cli/cli/issues/10712
- [rest-pulls] https://docs.github.com/en/rest/pulls/pulls
- [rest-commits] https://docs.github.com/en/rest/commits/commits
- [rest-review-comments] https://docs.github.com/en/rest/pulls/comments
- [repo-limits] https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#diff-limits
- [branches-ref] https://docs.github.com/en/pull-requests/reference/branches (redirect target of "About comparing branches in pull requests")
- [review-howto] https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request
- [gen-files] https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github
- [linking] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- [event-types] https://docs.github.com/en/rest/using-the-rest-api/issue-event-types
- [search-syntax] https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
- [gql-schema] GitHub GraphQL schema via introspection (`PullRequest`, `Issue`, `PullRequestReviewThread`, `PullRequestReviewComment`, `PullRequestChangedFile`, `CrossReferencedEvent`, `ConnectedEvent`, `DisconnectedEvent`); reference: https://docs.github.com/en/graphql/reference/objects
