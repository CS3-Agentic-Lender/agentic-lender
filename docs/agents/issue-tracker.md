# Issue tracker: Jira

Issues and specs for this repo live in Jira, space `AL` on https://alprojectcs3.atlassian.net (cloudId `dac36108-4e6e-4fa6-93ce-26b9ce88b6f4`). Use the Atlassian MCP tools for all operations.

If the Atlassian tools are unavailable, stop and ask the user to connect the Atlassian Rovo MCP server (`https://mcp.atlassian.com/v1/mcp/authv2`). Work lives only in Jira; GitHub Issues are not used.

## Structure

- **Epic**: one feature from the project brief.
- **Story**: one user story, parented to its epic.
- **Task**: non-feature work (CI, docs, retros), parented to an epic.
- **Bug**: a fault found in testing.
- **Subtask**: one person's technical piece of a story.

Every item carries one subsystem label (`mobile`, `web`, `core`, `ai`, `docs`) and, once triaged, one state label from `triage-labels.md`.

## Conventions

- **Create an issue**: `createJiraIssue` with `projectKey: "AL"`, `issueTypeName`, `summary`, `description` (markdown), `parent` (the epic key), and `additional_fields: {"labels": [...]}`.
- **Read an issue**: `getJiraIssue` with comments included.
- **List issues**: `searchJiraIssuesUsingJql`, e.g. `project = AL AND labels = needs-triage AND statusCategory != Done ORDER BY created ASC`.
- **Comment on an issue**: `addCommentToJiraIssue`.
- **Apply / remove labels**: `editJiraIssue` with `fields.labels`. This replaces the whole list, so read the current labels first and write the full updated list.
- **Close**: comment, then `transitionJiraIssue` to Done (find the id with `getTransitionsForJiraIssue`).

Branch, commit and PR titles must contain the Jira key (`AL-12`) so GitHub for Atlassian links them to the ticket.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(PRs live in GitHub and are reviewed there; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Jira issue in space `AL`.

## When a skill says "fetch the relevant ticket"

Run `getJiraIssue` on the `AL-<n>` key.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Jira Task with **child** Tasks as tickets.

- **Map**: a Task labelled `wayfinder-map`, holding the Notes / Decisions-so-far / Fog body in its description.
- **Child ticket**: a Task labelled `wayfinder-<type>` (`research`/`prototype`/`grilling`/`task`), linked to the map with a `Relates` link, with `Part of AL-<map>` as the first description line. Once claimed, it is assigned to the driving dev.
- **Blocking**: a `Blocks` issue link via `createIssueLink`. Per the tool, for "A is blocked by B" pass `inwardIssue: B`, `outwardIssue: A`. A ticket is unblocked when every blocker is Done.
- **Frontier query**: `project = AL AND issue in linkedIssues("AL-<map>") AND labels != wayfinder-map AND statusCategory != Done AND assignee is EMPTY`, then drop any with an open blocker; first in map order wins.
- **Claim**: `editJiraIssue` setting `assignee` to the current user (`atlassianUserInfo` gives the account id), as the session's first write.
- **Resolve**: `addCommentToJiraIssue` with the answer, transition to Done, then append a context pointer (gist + key) to the map's Decisions-so-far.
