# Reading GitHub issue and PR data: `gh` CLI vs REST/GraphQL

Research for [#138](https://github.com/a1457139709/VibeBridge/issues/138) (map [#136](https://github.com/a1457139709/VibeBridge/issues/136)). This note records facts only and does not choose an approach.

Sources were read on 2026-10-31: GitHub Docs (current REST API version `2026-03-10`) and the GitHub CLI manual. Local checks used `gh` 2.100.0 against `a1457139709/VibeBridge`. Results marked **Observed** come from those checks and are not documented behaviour.

## 1. What the two paths actually are

- `gh` is a client of the same APIs. `gh api <endpoint>` "makes an authenticated HTTP request to the GitHub API"; the endpoint is a REST v3 path, or `graphql` for v4 [gh-api]. It fills in `{owner}`/`{repo}` placeholders from the current directory's repo or `GH_REPO`. It supports `--paginate` (for GraphQL this needs `$endCursor` and `pageInfo`), `--slurp`, `--jq`, and `--cache <duration>` [gh-api].
- The high-level commands return structured JSON through `--json <fields>`. **Observed:** `gh issue list` uses GraphQL; with a bad token its error names `https://api.github.com/graphql`.
  - `gh issue list` / `gh issue view` fields: `assignees, author, blockedBy, blocking, body, closed, closedAt, closedByPullRequestsReferences, comments, createdAt, id, isPinned, issueType, labels, milestone, number, parent, projectCards, projectItems, reactionGroups, state, stateReason, subIssues, subIssuesSummary, title, updatedAt, url` [gh-issue-list], [gh-issue-view].
  - `gh pr list` / `gh pr view` fields include `isDraft, mergeable, mergeStateStatus, reviewDecision, reviewRequests, latestReviews, statusCheckRollup, autoMergeRequest, headRefName, headRefOid, baseRefName, closingIssuesReferences` [gh-pr-list], [gh-pr-view].
  - `gh pr checks --json` fields: `bucket, completedAt, description, event, link, name, startedAt, state, workflow`. `bucket` groups `state` into `pass`, `fail`, `pending`, `skipping` or `cancel` [gh-pr-checks].
  - `gh search issues --json` has a narrower field set with no dependency or sub-issue fields: `assignees, author, authorAssociation, body, closedAt, commentsCount, createdAt, id, isLocked, isPullRequest, labels, number, repository, state, title, updatedAt, url` [gh-search-issues].
- REST treats every PR as an issue. Issues endpoints may return PRs, which carry a `pull_request` key [rest-issues].

## 2. Authentication

**`gh`**
- `gh auth login` runs a browser flow by default and stores the token "in the system credential store". If no store is available, it falls back to a plain-text file. `--with-token` takes a classic PAT; the minimum scopes are `repo`, `read:org` and `gist`. For fine-grained PATs the manual prefers `GH_TOKEN` [gh-auth-login].
- Environment: `GH_TOKEN`, then `GITHUB_TOKEN` (in that order of precedence), "takes precedence over previously stored credentials" for github.com and `*.ghe.com`. `GH_ENTERPRISE_TOKEN` / `GITHUB_ENTERPRISE_TOKEN` serve GHES. `GH_HOST`, `GH_REPO`, `GH_CONFIG_DIR` and `GH_PROMPT_DISABLED` also exist [gh-env].
- `gh auth token` prints the active account's token for a host, refreshing an expiring token first unless `--no-refresh` is given [gh-auth-token]. An app calling REST/GraphQL directly could reuse the user's `gh` login this way.
- `gh auth status` exits 1 with output on stderr if any account has auth problems. With `--json` it always exits 0 unless there is a fatal error [gh-auth-status]. **Observed** `--json hosts` output fields: `state, active, host, login, tokenSource, scopes, gitProtocol`.

**Direct REST/GraphQL**
- Auth is a bearer token: a PAT (classic or fine-grained), a GitHub App token, or an OAuth app token [rest-auth], [gql-calls]. Fine-grained PATs always include read access to public repos. Classic PATs need `public_repo` for public repos, and `repo` for private ones [gql-calls], [rest-checks].
- REST can be called without auth for public data, at 60 requests/hour per IP [rest-rl]. **Observed:** unauthenticated GraphQL returned HTTP 403. The GraphQL docs only describe authenticated use [gql-calls].

## 3. Rate limits

| Bucket | Limit | Source |
| --- | --- | --- |
| REST, unauthenticated | 60 req/h per IP | [rest-rl] |
| REST, authenticated user (PAT, OAuth app, or GitHub App acting for the user; shared budget) | 5,000 req/h (15,000 for GHEC-owned apps) | [rest-rl] |
| GraphQL, user | 5,000 points/h (10,000 for GHEC-owned apps) | [gql-rl] |
| REST search (`/search/issues`) | 30 req/min authenticated, 10 req/min unauthenticated | [rest-search] |
| Semantic/hybrid issue search (`search_type`) | 10 req/min, auth required | [rest-search] |
| Secondary: concurrency | ≤100 concurrent requests, shared by REST and GraphQL | [rest-rl] |
| Secondary: per-endpoint points | 900 points/min REST, 2,000 points/min GraphQL; a GET or a GraphQL query costs 1 point, a write or mutation costs 5 | [rest-rl] |
| Secondary: CPU | ≤90 s of CPU per 60 s, of which ≤60 s may be GraphQL | [rest-rl] |

- How GraphQL cost is counted: add up the requests needed for each connection, assuming every `first`/`last` limit is reached, then divide by 100. The minimum is 1. `first`/`last` must be between 1 and 100. A single call may request at most 500,000 nodes. A query that takes more than 10 s times out and is charged extra points for the next hour [gql-rl].
- Response headers `x-ratelimit-limit`, `-remaining`, `-used`, `-reset` and `-resource` are authoritative. `GET /rate_limit` does not count against the primary limit [rest-rl]. In GraphQL, `rateLimit { limit remaining used resetAt cost }` reports the same [gql-rl].
- When a limit is exceeded:
  - REST answers `403` or `429` with `x-ratelimit-remaining: 0`.
  - GraphQL's primary limit answers **`200` with an error message**, and its secondary limit answers `200` or `403`.
  - Honour `retry-after` and `x-ratelimit-reset`. Otherwise wait at least 1 min and back off exponentially. Retrying while limited "may result in the banning of your integration" [rest-rl], [gql-rl].
- Best practices: send requests serially rather than concurrently [rest-best]. Use webhooks rather than polling. If you must poll, use conditional requests (`etag`/`last-modified`), because a `304 Not Modified` does not count against the primary limit [rest-best].
- All `gh` calls spend the same per-user budget as direct calls with the same token [rest-rl].

## 4. Issue search syntax

- REST `GET /search/issues?q=…` takes the same qualifiers as the web UI [rest-search], [search-syntax]:
  - type and state: `is:issue|pr`, `is:open|closed`, `is:merged|unmerged`, `is:draft` (draft-PR section), `is:queued`, `reason:completed|"not planned"`
  - scope: `repo:`, `org:`
  - people: `author:`, `assignee:`, `mentions:`, `involves:`, `@me`
  - metadata: `label:`, `milestone:`, `project:`
  - PRs: `linked:pr|issue`, `status:pending|success|failure`, `review:none|required|approved|changes_requested`, `review-requested:`, `head:`, `base:`
  - dates: `created:`, `updated:`, `closed:`, `merged:`
  - negation with `-qualifier`
- Advanced search: `AND`/`OR` and parentheses nested up to 5 levels [filtering]. REST turns it on with `advanced_search=true` [rest-search]. In `gh issue list --search` and `gh search issues`, advanced syntax is used "on supported GitHub hosts". For `gh search issues`, boolean operators and parentheses "must be passed as separate arguments" [gh-issue-list], [gh-search-issues].
- Limits [rest-search]:
  - at most 1,000 results per search, and at most 100 per page
  - queries over 256 characters (excluding operators and qualifiers) are rejected
  - more than five `AND`/`OR`/`NOT` operators gives `422 Validation failed`
  - at most 4,000 repositories are searched
  - a timeout returns partial results with `incomplete_results: true`
  - GitHub App user tokens must include `is:issue` or `is:pull-request`, or they get `422`
- Search status codes: `200, 304, 401, 403, 422, 503` [rest-search].
- **Observed** with `advanced_search=true` on this repo:
  - `is:blocked` and `is:blocking` filtered correctly; they matched the dependency edges.
  - `has:parent-issue` returned a plausible subset (65 of 142).
  - `has:sub-issues` matched every item, so it was effectively ignored.
  - `parent-issue:<repo>#136`, `parent-issue:136`, `blocked-by:…` and `blocking:…` all returned 0, although #136 has nine sub-issues.
  - An unknown qualifier also returned 0.

  None of these relationship qualifiers appear on the docs pages above. For relationships, read the dedicated endpoints or fields instead of relying on search.

## 5. PR status and checks fields

**REST `GET /repos/{o}/{r}/pulls/{n}`** [rest-pulls]
- Fields: `state`, `draft`, `merged`, `mergeable` (bool or null), `rebaseable`, `mergeable_state` (string), `merged_by`, `auto_merge`, `requested_reviewers`, `comments`, `review_comments`, `commits`, `additions`, `deletions`, `changed_files`, `head`/`base` (ref, sha).
- `mergeable: null` means a background job is still computing it, so resubmit the request later.
- List endpoints do not return `mergeable`.

**REST checks and statuses**
- `GET /repos/{o}/{r}/commits/{ref}/check-runs` returns check runs [rest-checks]:
  - `status` is one of `queued|in_progress|completed|waiting|requested|pending`.
  - `conclusion` is one of `success|failure|neutral|cancelled|skipped|timed_out|action_required|null`.
  - Only the 1,000 most recent check suites per ref are covered.
  - Pushes to a fork return an empty `pull_requests` array.
  - Classic tokens need `repo` for private repos.
- `GET /repos/{o}/{r}/commits/{ref}/status` returns the combined commit status: `failure` if any context reports error or failure, `pending` if there are none or one is pending, otherwise `success`. Statuses are a separate system from checks [rest-statuses].

**GraphQL `PullRequest`** (schema introspected 2026-10-31)
- Fields include `state`, `isDraft`, `merged`, `mergedAt`, `mergeable`, `mergeStateStatus`, `reviewDecision`, `reviewRequests`, `latestReviews`, `statusCheckRollup`, `isInMergeQueue`, `autoMergeRequest`, `closingIssuesReferences`, `headRefOid`, `checksUrl`.
- Enums:
  - `MergeableState`: `MERGEABLE | CONFLICTING | UNKNOWN`
  - `MergeStateStatus`: `CLEAN | DIRTY | BLOCKED | BEHIND | UNSTABLE | HAS_HOOKS | UNKNOWN`
  - `PullRequestReviewDecision`: `APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED`
- `StatusCheckRollup { state, contexts }`:
  - `state` is a `StatusState`: `EXPECTED | ERROR | FAILURE | PENDING | SUCCESS`.
  - `contexts` is a union of `CheckRun` and `StatusContext`.
  - `CheckRun` has `name, status, conclusion, isRequired, detailsUrl, startedAt, completedAt, checkSuite`.
  - `StatusContext` has `context, state, description, targetUrl, isRequired`.
  - `CheckConclusionState` adds `STARTUP_FAILURE` and `STALE` to the REST values.
- **Observed:** `gh pr list --json statusCheckRollup` returns each CheckRun with `__typename, name, status, conclusion, workflowName, detailsUrl, startedAt, completedAt`. For a merged PR, `mergeable` and `mergeStateStatus` came back `UNKNOWN`.

## 6. Sub-issues and issue dependencies

Both can be read through REST, GraphQL and `gh`.

**REST** [rest-sub-issues], [rest-deps]
- Sub-issues:
  - `GET /repos/{o}/{r}/issues/{n}/sub_issues` is paginated, `per_page` ≤ 100, with statuses 200/404/410.
  - `GET …/issues/{n}/parent` has statuses 200/301/404/410.
  - Write endpoints add, remove and reprioritize.
- Dependencies:
  - `GET …/issues/{n}/dependencies/blocked_by` and `GET …/issues/{n}/dependencies/blocking`.
  - To add an edge, `POST …/dependencies/blocked_by`, which takes an `issue_id`. This is the database id, not the issue number.
- Every issue object, including search results, carries summary blocks [rest-search]:
  - `sub_issues_summary {total, completed, percent_completed}`
  - `issue_dependencies_summary {blocked_by, blocking, total_blocked_by, total_blocking}`

  So one list call shows whether an issue has open blockers without fetching its edges.

**GraphQL `Issue`** has `parent`, `subIssues`, `subIssuesSummary {total completed percentCompleted}`, `blockedBy`, `blocking`, `issueDependenciesSummary {blockedBy blocking totalBlockedBy totalBlocking}`, and also `trackedIssues`/`trackedInIssues`, `issueType` and `issueFieldValues` (introspected).

**`gh`**: `issue list`/`view --json parent,subIssues,subIssuesSummary,blockedBy,blocking` [gh-issue-list]. **Observed:** `gh issue view 138 --json …` returned `parent` #136, `blocking` [#140] and an empty `blockedBy`, matching the REST endpoints.

## 7. Errors when signed out or without permission

**Documented**
- REST:
  - A missing token or insufficient permission gives `404 Not Found` or `403 Forbidden`.
  - Invalid credentials give `401 Unauthorized` [rest-auth].
  - A private resource requested without proper auth gives **404, not 403**, "to avoid confirming the existence of private repositories" [rest-trouble].
  - A fine-grained PAT or GitHub App without enough permission gets "Resource not accessible by personal access token / by integration". The `X-Accepted-GitHub-Permissions` header lists the permissions required [rest-trouble].
  - An org that enforces SAML SSO can give 403 with an `X-GitHub-SSO` header [rest-auth].
- GraphQL: a missing scope returns an error message that names the scopes needed [gql-calls].
- `gh` exit codes: 0 ok, 1 failure, 2 cancelled, **4 authentication required** [gh-exit]. `gh pr checks` also exits **8** when checks are pending [gh-pr-checks].

**Observed** (gh 2.100.0)

| Situation | Result |
| --- | --- |
| `gh issue list` / `gh api` with no stored login and no `GH_TOKEN` | stderr `To get started with GitHub CLI, please run:  gh auth login` / `Alternatively, populate the GH_TOKEN environment variable…`, exit **4** |
| `gh issue list` with an invalid `GH_TOKEN` | `HTTP 401: Bad credentials (https://api.github.com/graphql)` / `Try authenticating with:  gh auth login -h github.com`, exit 1 |
| `gh api repos/…` with an invalid token | body `{"message":"Bad credentials","status":"401"}`, stderr `gh: Bad credentials (HTTP 401)`, exit 1 |
| `gh issue list -R` on a missing or inaccessible repo | `GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)`, exit 1 |
| `gh api` REST on a missing or inaccessible repo | `{"message":"Not Found","status":"404"}`, `gh: Not Found (HTTP 404)`, exit 1 |
| GraphQL on a missing or inaccessible repo | HTTP 200, `data.repository: null`, `errors[].type: "NOT_FOUND"` |
| `curl` unauthenticated GraphQL | HTTP 403 |

A missing repo and a private repo you cannot access look the same in every path: REST 404, or GraphQL `NOT_FOUND`.

## 8. Trade-offs (for the decision, not a decision)

- **`gh` subprocess**
  - Reuses the user's existing login, keychain storage, token refresh and multi-account handling at no cost.
  - Covers every needed field through `--json`, including dependencies, sub-issues and `statusCheckRollup`.
  - `gh api` gives full REST/GraphQL access for anything the commands miss.
  - Costs: it is an external dependency that must be installed and logged in. It adds process-spawn overhead per call. Errors arrive as exit codes plus stderr text, which is parsed by convention and has no stable schema. The JSON shape follows `gh`'s choices, such as `blockedBy {nodes,totalCount}`.
- **Direct REST/GraphQL**
  - Gives typed, documented responses. Rate-limit headers, ETag/304 conditional requests and `retry-after` handling are all available to the app.
  - One GraphQL query can fetch issues, relationships and PR rollups together.
  - Costs: the app must source and protect a token. It can borrow one from `gh auth token`, which still needs `gh`, or ask the user for a PAT, or run its own OAuth/App flow. It must also handle 401/403/404/429 and GraphQL's 200-with-errors itself.
- **Either path**
  - The search API's 30 req/min limit is the tightest budget. Listing a repo's issues through list endpoints instead of search avoids it.
  - Relationship search qualifiers did not work reliably in the checks above, so relationship data should come from the dedicated fields or endpoints.

## Sources

- [gh-api] https://cli.github.com/manual/gh_api
- [gh-auth-login] https://cli.github.com/manual/gh_auth_login
- [gh-auth-status] https://cli.github.com/manual/gh_auth_status
- [gh-auth-token] https://cli.github.com/manual/gh_auth_token
- [gh-env] https://cli.github.com/manual/gh_help_environment
- [gh-exit] https://cli.github.com/manual/gh_help_exit-codes
- [gh-issue-list] https://cli.github.com/manual/gh_issue_list
- [gh-issue-view] https://cli.github.com/manual/gh_issue_view
- [gh-pr-list] https://cli.github.com/manual/gh_pr_list
- [gh-pr-view] https://cli.github.com/manual/gh_pr_view
- [gh-pr-checks] https://cli.github.com/manual/gh_pr_checks
- [gh-search-issues] https://cli.github.com/manual/gh_search_issues
- [rest-rl] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- [gql-rl] https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- [gql-calls] https://docs.github.com/en/graphql/guides/forming-calls-with-graphql
- [rest-auth] https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
- [rest-trouble] https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
- [rest-best] https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- [rest-search] https://docs.github.com/en/rest/search/search
- [search-syntax] https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
- [filtering] https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests
- [rest-issues] https://docs.github.com/en/rest/issues/issues
- [rest-pulls] https://docs.github.com/en/rest/pulls/pulls
- [rest-checks] https://docs.github.com/en/rest/checks/runs
- [rest-statuses] https://docs.github.com/en/rest/commits/statuses
- [rest-sub-issues] https://docs.github.com/en/rest/issues/sub-issues
- [rest-deps] https://docs.github.com/en/rest/issues/issue-dependencies
- GraphQL schema: live introspection of `PullRequest`, `Issue`, `StatusCheckRollup`, `CheckRun`, `StatusContext` and the related enums via `gh api graphql`, 2026-10-31.
