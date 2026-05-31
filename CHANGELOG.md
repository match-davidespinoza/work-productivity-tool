# Changelog

## [2.0.0] - 2026-05-31

### Added
- Work Tracker tab: generate AI-written contribution summaries from GitHub PRs, local git commits, and Jira activity for any date range
- Summaries are saved as Markdown files to `~/Documents/WorkTracker/summaries/` with YAML frontmatter and can be viewed, browsed, or deleted from within the app
- GitHub auth flow via `gh auth login --web`, launched in a Terminal window with an IPC handler (`wt-gh-do-auth`, `wt-gh-auth-status`)
- Tab bar navigation — app now supports multiple named tabs with a home/welcome screen
- Home screen with quick-access tiles to each tab

### Changed
- Replaced dynamic light/dark system theme with a fixed Catppuccin Mocha color palette across the entire UI
- Removed automated changelog generation from the release script — `scripts/release.js` now runs the electron-builder command directly without version prompting

## [1.0.0] - 2026-05-20

### Added
- Initial release of Jira Scanner, a local Electron desktop app for monitoring Jira issues
- Six built-in reports: Recent Comments, Open Tickets, High Priority, Recently Updated, Overdue Issues, and Blocked Issues
- Jira REST API integration using Basic Auth (email + API token) stored locally — no cloud services
- Okta SSO login flow via a sandboxed browser window; session cookies are persisted and used automatically for subsequent API calls
- System tray icon with a popup window showing recent comments at a glance
- Desktop notifications via the system notification API
- Launch at login toggle in settings
- macOS hidden-inset title bar for a native look
- Cross-platform build support: macOS (DMG), Windows (NSIS installer), Linux (AppImage)
- Separate tray icon from app/dock icon, with automatic light/dark mode switching
- Mark as seen on individual comments — clicking the indicator fades the comment and persists state across sessions
- Seen state syncs in real time between the tray popup and the main app window via IPC
