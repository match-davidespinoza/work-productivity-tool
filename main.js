const { app, BrowserWindow, shell, ipcMain, Tray, nativeImage, Notification, nativeTheme, screen } = require('electron');
const { execFile, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Work Tracker constants ────────────────────────────────────────────────────
const SUMMARIES_DIR = path.join(os.homedir(), 'Documents', 'WorkTracker', 'summaries');
const BIN_PATH = '/usr/local/bin:/opt/homebrew/bin:/Users/david.espinoza/.local/bin';

function runShell(command) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: process.env.PATH + ':' + BIN_PATH };
    exec(command, { env, maxBuffer: 10 * 1024 * 1024 }, (_err, stdout) => {
      resolve(stdout ? stdout.trim() : '');
    });
  });
}

function todayEnd() {
  // End of today as an ISO string — ensures "until present" includes the full current day
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString().split('T')[0];
}

async function gatherGitHub(since, until) {
  const untilDate = until === 'present' ? todayEnd() : until;
  // Use --updated (not --created) so PRs reviewed/merged/commented in the range are included
  const cmd = `gh search prs --author match-davidespinoza --updated="${since}..${untilDate}" --json number,title,state,createdAt,updatedAt,url,repository --limit 100`;
  return (await runShell(cmd)) || '[]';
}

async function gatherCommits(since, until) {
  // For "until", use the next day at midnight so today's commits are fully included
  let untilDate;
  if (until === 'present') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    untilDate = d.toISOString().split('T')[0];
  } else {
    // Add one day to include the full end date
    const d = new Date(until);
    d.setDate(d.getDate() + 1);
    untilDate = d.toISOString().split('T')[0];
  }
  const devDir = path.join(os.homedir(), 'dev');
  let repos = [];
  try {
    repos = fs.readdirSync(devDir).filter(d => {
      try { return fs.statSync(path.join(devDir, d, '.git')).isDirectory(); }
      catch { return false; }
    });
  } catch { return 'Could not read ~/dev'; }
  const results = await Promise.all(repos.map(async repo => {
    const out = await runShell(
      `git -C "${path.join(devDir, repo)}" log --oneline --since="${since}" --until="${untilDate}" --author="david.espinoza" --format="%h %s" 2>/dev/null`
    );
    return out ? `=== ${repo} ===\n${out}` : null;
  }));
  return results.filter(Boolean).join('\n\n') || 'No commits found.';
}

async function gatherJira(since, until) {
  const untilDate = until === 'present' ? todayEnd() : until;
  const jql = `(assignee = currentUser() OR reporter = currentUser()) AND updated >= "${since}" AND updated <= "${untilDate}" ORDER BY updated DESC`;
  const raw = await runShell(`acli jira workitem search --jql '${jql}' --limit 50 --json`);
  if (!raw) return 'No Jira activity found.';
  try {
    const issues = JSON.parse(raw);
    if (!issues.length) return 'No Jira activity found.';
    return issues.map(i => `${i.key}: ${i.fields?.summary || ''} [${i.fields?.status?.name || ''}]`).join('\n');
  } catch { return raw.slice(0, 3000); }
}

async function summarize(prs, commits, jira, label, since, until) {
  const untilDisplay = until === 'present' ? 'today' : until;
  const sections = [];
  if (prs !== null)     sections.push(`=== GITHUB PULL REQUESTS ===\n${prs}`);
  if (commits !== null) sections.push(`=== GIT COMMITS (across all ~/dev repos) ===\n${commits}`);
  if (jira !== null)    sections.push(`=== JIRA ACTIVITY ===\n${jira}`);
  const prompt = `Summarize this engineer's contributions for the period: ${label} (${since} to ${untilDisplay}).

${sections.join('\n\n')}

Write a clear, humanized summary. Group by theme/project. Use plain prose paragraphs. Include:
- What was built or fixed and why it matters
- Any multi-PR or multi-ticket efforts
- A brief "at a glance" stat line at the end (PRs opened, PRs merged, Jira tickets, repos touched)

Important rules:
- Commits are first-class evidence of work. Any repo with commits in the period represents real contribution, regardless of whether a GitHub PR exists. Do not downplay or bury commit-only work.
- If a repo has an "Initial commit" or its first-ever commit falls in this period, treat it as a notable new project creation and describe what was built based on the commit messages.
- Only include Jira tickets where real work was done during this period.
- Pay close attention to commit and PR dates. Do NOT group work together just because it uses similar technology.

Tone: professional but conversational. Start with: ## Contributions: ${label}`;
  const escaped = prompt.replace(/'/g, "'\\''");
  const out = await runShell(`cd ~ && claude -p --tools '' --output-format text '${escaped}'`);
  if (!out) throw new Error('claude CLI returned no output');
  return out;
}

function saveSummary(since, until, label, content) {
  if (!fs.existsSync(SUMMARIES_DIR)) fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
  const safeName = label.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
  const untilPart = until === 'present' ? 'present' : until;
  const filename = `${since}_${untilPart}_${safeName}.md`;
  const frontmatter = `---\nperiod: "${label}"\nsince: "${since}"\nuntil: "${untilPart}"\n---\n\n`;
  fs.writeFileSync(path.join(SUMMARIES_DIR, filename), frontmatter + content);
  return filename;
}

let tray = null;
let trayWindow = null;
let backdropWindow = null;
let trayPopupShownAt = 0;

const ACLI_BIN = '/opt/homebrew/bin/acli';

function runAcli(args) {
  return new Promise((resolve, reject) => {
    execFile(ACLI_BIN, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 750,
    minWidth: 700,
    minHeight: 550,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('get-login-item', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('set-login-item', (_event, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
});

ipcMain.handle('acli-get-config', () => {
  try {
    const configPath = path.join(os.homedir(), '.config', 'acli', 'jira_config.yaml');
    const content = fs.readFileSync(configPath, 'utf8');
    const site = (content.match(/- site: (.+)/) || [])[1]?.trim();
    const accountId = (content.match(/account_id: (.+)/) || [])[1]?.trim();
    const displayName = (content.match(/display_name: (.+)/) || [])[1]?.trim();
    return { ok: !!(site && accountId), site: site || '', accountId: accountId || '', displayName: displayName || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-do-auth', () => {
  return new Promise((resolve) => {
    // Write AppleScript to a temp file to avoid shell-escaping nightmares.
    // acli needs an interactive TTY for site selection after browser OAuth.
    const scriptContent = `tell application "Terminal"
  do script "acli jira auth login --web; sleep 1; osascript -e 'tell application \\"Terminal\\" to close front window'; exit"
  activate
end tell`;
    const tmpScript = path.join(os.tmpdir(), 'jira-scanner-auth.scpt');
    try { fs.writeFileSync(tmpScript, scriptContent); } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    exec(`osascript "${tmpScript}"`, (err) => {
      resolve({ ok: !err, pendingTerminal: !err, error: err ? err.message : null });
    });
  });
});

ipcMain.handle('acli-check-auth', async () => {
  try {
    await runAcli(['jira', 'workitem', 'search', '--jql', 'assignee = currentUser()', '--limit', '1', '--json']);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-search', async (_event, { jql, fields, limit }) => {
  try {
    const args = ['jira', 'workitem', 'search', '--jql', jql, '--json'];
    if (fields) args.push('--fields', fields);
    if (limit) args.push('--limit', String(limit));
    const body = await runAcli(args);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-view', async (_event, { key, fields }) => {
  try {
    const args = ['jira', 'workitem', 'view', key, '--json'];
    if (fields) args.push('--fields', fields);
    const body = await runAcli(args);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── GitHub auth IPC ──────────────────────────────────────────────────────────

ipcMain.handle('wt-gh-auth-status', async () => {
  return new Promise((resolve) => {
    exec('gh auth status', { env: { ...process.env, PATH: process.env.PATH + ':' + BIN_PATH } }, (err) => {
      resolve({ ok: !err });
    });
  });
});

ipcMain.handle('wt-gh-do-auth', () => {
  return new Promise((resolve) => {
    const scriptContent = `tell application "Terminal"
  do script "gh auth login --web; sleep 1; osascript -e 'tell application \\"Terminal\\" to close front window'; exit"
  activate
end tell`;
    const tmpScript = path.join(os.tmpdir(), 'jira-scanner-gh-auth.scpt');
    try { fs.writeFileSync(tmpScript, scriptContent); } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    exec(`osascript "${tmpScript}"`, (err) => {
      resolve({ ok: !err, pendingTerminal: !err, error: err ? err.message : null });
    });
  });
});

// ── GitHub PR scanner IPC ────────────────────────────────────────────────────

let ghPrsCache = null;
let ghPrsCacheTime = 0;
const GH_PR_CACHE_TTL = 5 * 60 * 1000;

ipcMain.handle('gh-open-prs', async (_e, { force } = {}) => {
  if (!force && ghPrsCache && Date.now() - ghPrsCacheTime < GH_PR_CACHE_TTL) {
    return { ok: true, prs: ghPrsCache, fetchedAt: ghPrsCacheTime };
  }
  try {
    const listOut = await runShell(
      'gh search prs --author @me --state open --json number,title,url,repository,updatedAt,isDraft --limit 50'
    );
    const raw = JSON.parse(listOut || '[]');
    // Normalize: gh search prs uses `repository`, gh pr list uses `headRepository`
    const prs = raw.map(pr => ({ ...pr, headRepository: pr.repository }));

    const withDetails = await Promise.all(prs.map(async (pr) => {
      try {
        const repo = pr.headRepository?.nameWithOwner;
        if (!repo) return { ...pr, comments: [], reviewThreads: [], reviews: [], reviewDecision: null };
        const [viewOut, inlineOut] = await Promise.all([
          runShell(`gh pr view ${pr.number} --repo "${repo}" --json comments,reviews,reviewDecision`),
          runShell(`gh api "repos/${repo}/pulls/${pr.number}/comments" --paginate`),
        ]);
        const detail = JSON.parse(viewOut || '{}');
        const inlineComments = JSON.parse(inlineOut || '[]');

        // Group inline comments into threads: root comments + their replies
        const roots = inlineComments.filter(c => !c.in_reply_to_id);
        const replyMap = {};
        inlineComments.filter(c => c.in_reply_to_id).forEach(r => {
          if (!replyMap[r.in_reply_to_id]) replyMap[r.in_reply_to_id] = [];
          replyMap[r.in_reply_to_id].push(r);
        });
        const reviewThreads = roots.map(root => ({
          isResolved: false,
          isOutdated: root.position === null,
          path: root.path,
          comments: [
            { author: { login: root.user?.login }, body: root.body, createdAt: root.created_at, url: root.html_url },
            ...(replyMap[root.id] || []).map(r => ({ author: { login: r.user?.login }, body: r.body, createdAt: r.created_at, url: r.html_url })),
          ],
        }));

        return { ...pr, comments: detail.comments || [], reviewThreads, reviews: detail.reviews || [], reviewDecision: detail.reviewDecision ?? null };
      } catch {
        return { ...pr, comments: [], reviewThreads: [], reviews: [] };
      }
    }));

    ghPrsCache = withDetails;
    ghPrsCacheTime = Date.now();
    return { ok: true, prs: withDetails, fetchedAt: ghPrsCacheTime };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Work Tracker IPC ─────────────────────────────────────────────────────────

ipcMain.handle('wt-generate', async (_e, { since, until, label, source }) => {
  const useGitHub = source !== 'jira';
  const useJira   = source !== 'github';
  const [prs, commits, jira] = await Promise.all([
    useGitHub ? gatherGitHub(since, until)  : Promise.resolve(null),
    useGitHub ? gatherCommits(since, until) : Promise.resolve(null),
    useJira   ? gatherJira(since, until)    : Promise.resolve(null),
  ]);
  const isEmpty = (v) => !v || v === '[]' || v === 'No commits found.' || v === 'No Jira activity found.';
  if ([prs, commits, jira].every(isEmpty)) return { summary: null, filename: null };
  const summary = await summarize(prs, commits, jira, label, since, until);
  const filename = saveSummary(since, until, label, summary);
  return { summary, filename };
});

ipcMain.handle('wt-list-summaries', () => {
  if (!fs.existsSync(SUMMARIES_DIR)) return [];
  return fs.readdirSync(SUMMARIES_DIR)
    .filter(f => f.endsWith('.md'))
    .sort().reverse()
    .map(f => {
      const raw = fs.readFileSync(path.join(SUMMARIES_DIR, f), 'utf8');
      const match = raw.match(/period: "(.+)"/);
      return { filename: f, label: match ? match[1] : f };
    });
});

ipcMain.handle('wt-delete-summary', (_e, filename) => {
  fs.unlinkSync(path.join(SUMMARIES_DIR, filename));
});

ipcMain.handle('wt-read-summary', (_e, filename) => {
  return fs.readFileSync(path.join(SUMMARIES_DIR, filename), 'utf8').replace(/^---[\s\S]*?---\n\n/, '');
});

function hideTrayPopup() {
  trayWindow.hide();
  backdropWindow.hide();
}

function createTrayWindow() {
  trayWindow = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });
  trayWindow.setAlwaysOnTop(true, 'pop-up-menu');
  trayWindow.loadFile(path.join(__dirname, 'src', 'tray-popup.html'));
  trayWindow.on('blur', () => hideTrayPopup());

  backdropWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  backdropWindow.setAlwaysOnTop(true, 'pop-up-menu');
  backdropWindow.loadFile(path.join(__dirname, 'src', 'backdrop.html'));
  backdropWindow.on('blur', () => {
    if (Date.now() - trayPopupShownAt < 500) return;
    hideTrayPopup();
  });
}

function getTrayIcon() {
  const file = nativeTheme.shouldUseDarkColors ? 'tray-icon.png' : 'tray-icon-light.png';
  const img = nativeImage.createFromPath(path.join(__dirname, file)).resize({ width: 16, height: 16 });
  img.setTemplateImage(false);
  return img;
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Jira Scanner');

  nativeTheme.on('updated', () => tray.setImage(getTrayIcon()));

  tray.on('click', (_event, bounds) => {
    if (trayWindow.isVisible()) {
      hideTrayPopup();
      return;
    }

    const { x, y } = bounds;
    const { width } = trayWindow.getBounds();
    trayWindow.setPosition(
      Math.round(x - width / 2 + bounds.width / 2),
      Math.round(y + bounds.height + 4)
    );

    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    backdropWindow.setBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    backdropWindow.show();
    backdropWindow.focus();

    trayPopupShownAt = Date.now();
    trayWindow.show();
    trayWindow.webContents.send('fetch-comments');
  });
}

ipcMain.on('backdrop-clicked', () => hideTrayPopup());

ipcMain.on('seen-updated', (_event, commentId, isSeen) => {
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== trayWindow) w.webContents.send('seen-updated', commentId, isSeen);
  });
});

ipcMain.on('notify', (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({
    title,
    body,
    icon: path.join(__dirname, 'icon.png'),
  }).show();
});

ipcMain.handle('open-main-window', () => {
  const wins = BrowserWindow.getAllWindows().filter(w => w !== trayWindow && w !== backdropWindow);
  if (wins.length) {
    wins[0].show();
    wins[0].focus();
  } else {
    createWindow();
  }
  hideTrayPopup();
});

app.on('will-resign-active', () => {
  if (Date.now() - trayPopupShownAt < 500) return;
  if (trayWindow && trayWindow.isVisible()) hideTrayPopup();
});

app.whenReady().then(() => {
  createWindow();
  createTrayWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter(w => w !== trayWindow && w !== backdropWindow).length === 0) createWindow();
  });
});

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && (url.startsWith('http:') || url.startsWith('https:'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
