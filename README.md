# That Time My Homie Got Reincarnated as a Work Productivity Tool

A local Electron desktop app and personal engineering dashboard. No cloud services — everything runs on your machine using the GitHub and Atlassian CLIs.

## Requirements

- [**`gh`**](https://cli.github.com/) — GitHub CLI, authenticated via `gh auth login`
- [**`acli`**](https://www.npmjs.com/package/acli) — Atlassian CLI, authenticated via `acli jira auth login --web`
- [**`claude`**](https://docs.anthropic.com/en/docs/claude-code) — Claude CLI, used to generate AI summaries and PR reviews

## Setup

```bash
npm install
npm start
```

On first launch, authenticate each service from within the app or via the terminal:

```bash
gh auth login          # GitHub
acli jira auth login --web   # Jira (Atlassian)
```

---

## Tabs

### Work Tracker

Generates AI-written summaries of your engineering contributions over a selected time range, pulling from:

- **GitHub PRs** — searched via `gh search prs --author`
- **Git commits** — scanned across all repos in `~/dev`
- **Jira activity** — issues assigned to or reported by you

**Time range presets:** 24h, 1 week, 2 weeks, 30 days, 90 days, this year, or custom date range.

**Data source filter:** Jira & GitHub, Jira only, or GitHub only.

**Standup Summary** generates a concise bullet-point update (Completed / In Progress / Blockers / Next Up) using the selected range.

Summaries are saved as Markdown files to `~/Documents/WorkTracker/summaries/` and can be browsed, loaded, or deleted from the sidebar history.

---

### Jira Scanner

Monitors your Jira issues with six built-in reports, refreshable on demand with a configurable time window:

| Report | Description |
|---|---|
| Recent Comments | Comments on issues you're assigned to, watching, reported, or tagged on |
| Open Tickets | All open issues currently assigned to you |
| High Priority | High and Highest priority open issues assigned to you |
| Recently Updated | Issues updated within the selected time window |
| Overdue Issues | Past-due issues that aren't done |
| Blocked Issues | Issues labeled or statused as Blocked |

Individual comments can be marked as seen (faded) — state persists across sessions and syncs with the tray popup.

---

### GitHub PRs

Shows all your open pull requests across all repos, grouped by repository. Each PR card expands to show:

- Unresolved inline review threads (with file path and comment preview)
- Recent PR conversation comments
- Review decision badge (Approved, Changes Requested, Review Required, Draft)

---

### PR Reviewer

Paste any GitHub PR URL to generate an AI-powered code review. The review takes into account:

- The full PR diff
- Existing reviewer comments and inline threads
- PR conversation comments

The generated review renders as formatted Markdown with two actions:
- **Copy** — copy the review text to the clipboard
- **Post to PR** — post the review as a comment directly to the GitHub PR as yourself

No local clone required — everything is fetched remotely via the `gh` CLI.

---

## Settings

Accessible via the ⚙ icon in the top-right corner.

- **Appearance** — Light / Dark mode toggle
- **Theme** — Catppuccin, Classic, Dracula, Tokyo Night, Nord
- **Notifications**
  - Open at login
  - Jira — new comment notifications (polls every 60 seconds)
  - GitHub PRs — new activity notifications (polls every 60 seconds, detects new comments, threads, and review decisions)

---

## System Tray

A tray icon in the menu bar opens a compact popup with recent Jira comments at a glance. Click any comment to open the issue in the browser.

---

## Build

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows installer
npm run build:linux  # Linux AppImage
```
