# Refreshing the dashboard data (`npm run sync`)

The dashboard reads from `src/issues.json`. The sync script regenerates that file
straight from Jira's REST API — no MCP, no browser login — so it can run unattended
(e.g. on a schedule before the 9:30 standup).

## One-time setup

1. Create a Jira API token: https://id.atlassian.com/manage-profile/security/api-tokens
   → "Create API token", name it (e.g. `standup-dashboard`), copy the value.
2. In the project root, copy `.env.example` to `.env` and fill it in:

   ```
   JIRA_SITE=growth99.atlassian.net
   JIRA_EMAIL=mehul.kothari@growth99.com
   JIRA_API_TOKEN=<the token you just created>
   ```

   `.env` is gitignored — the token never gets committed.

## Run it

```bash
npm run sync
```

It will:
- pull the current open sprint (`project = G99PRODUCT AND sprint in openSprints()`),
- read each ticket's Primary QA (`customfield_10140`) and story points (`customfield_10016`),
- fetch the changelog for every ticket that reached QA and compute QA cycle time,
  ongoing-in-QA time, and total lifecycle,
- overwrite `src/issues.json`.

Then reload the dashboard (`npm run dev`) to see fresh numbers.

## What each field means

| Field | Meaning |
|---|---|
| `staleDays` | days since the ticket was last updated |
| `blocked` | `true` when status is `QA BLOCKED` |
| `primaryQA` | QA engineer(s) from the Primary QA field (comma-joined if more than one) |
| `qaCycleDays` | entered QA Review → first Ready to Release / Done / Released To Prod |
| `qaOngoingDays` | for tickets still in QA: days since they entered QA |
| `lifecycleDays` | created → done |
| `history` | real status transitions from the changelog |

## Scheduling (optional)

To auto-refresh before standup, run `npm run sync` on a schedule:

- **Windows Task Scheduler**: create a Basic Task, trigger daily at 09:15, action
  `npm` with args `run sync` and "Start in" set to this project folder.
- Or any cron-like runner: `cd <project> && npm run sync`.

Config lives at the top of `scripts/fetch-sprint.js` (project key, field IDs,
done-status list) if any of it changes in Jira.
