@echo off
REM Auto-refresh the standup dashboard data from Jira.
REM Requires .env with JIRA_SITE / JIRA_EMAIL / JIRA_API_TOKEN in this folder.
cd /d "E:\work\other g99\standup-dashboard"
call npm run sync >> sync.log 2>&1
