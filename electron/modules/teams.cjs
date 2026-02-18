/**
 * Team agent watcher — monitors ~/.claude/teams/ and ~/.claude/tasks/
 * for live updates without touching SDK internals.
 *
 * File layout:
 *   ~/.claude/teams/{team}/config.json       → team info + members
 *   ~/.claude/teams/{team}/inboxes/{agent}.json  → inter-agent messages
 *   ~/.claude/tasks/{team}/{id}.json         → task list with status
 */

const fs   = require("node:fs");
const path = require("node:path");
const os   = require("node:os");

const TEAMS_DIR = path.join(os.homedir(), ".claude", "teams");
const TASKS_DIR = path.join(os.homedir(), ".claude", "tasks");

// webContents reference set once the window is ready
let _webContents = null;

// Active fs.watch handles — cleaned up on window close
const _watchers = new Map(); // key → FSWatcher

// In-memory cache: teamName → { config, tasks, inboxes }
const _state = new Map();

// Teams for which we already fired "allDone" — avoid repeat notifications
const _notifiedComplete = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(channel, payload) {
  try {
    if (_webContents && !_webContents.isDestroyed()) {
      _webContents.send(channel, payload);
    }
  } catch {
    // renderer may have been destroyed
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readTeamConfig(teamName) {
  const cfgPath = path.join(TEAMS_DIR, teamName, "config.json");
  return safeReadJson(cfgPath);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function readTeamTasks(teamName) {
  const dir = path.join(TASKS_DIR, teamName);
  const tasks = [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const task = safeReadJson(path.join(dir, file));
      if (task) tasks.push(task);
    }
  } catch {
    // dir may not exist yet
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}

// ---------------------------------------------------------------------------
// Inboxes
// ---------------------------------------------------------------------------

function readInboxes(teamName) {
  const inboxDir = path.join(TEAMS_DIR, teamName, "inboxes");
  const inboxes = {};
  try {
    const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const agentName = file.replace(".json", "");
      const messages = safeReadJson(path.join(inboxDir, file));
      if (Array.isArray(messages)) inboxes[agentName] = messages;
    }
  } catch {
    // no inboxes yet
  }
  return inboxes;
}

// ---------------------------------------------------------------------------
// Snapshot & diff
// ---------------------------------------------------------------------------

function snapshotTeam(teamName) {
  const config  = readTeamConfig(teamName);
  const tasks   = readTeamTasks(teamName);
  const inboxes = readInboxes(teamName);
  return { config, tasks, inboxes };
}

function emitFullSnapshot(teamName) {
  const snap = snapshotTeam(teamName);
  _state.set(teamName, snap);
  send("teams:snapshot", { teamName, ...snap });

  // Fire "allDone" once when all tasks (≥1) reach completed/deleted
  if (!_notifiedComplete.has(teamName) && snap.tasks.length > 0) {
    const pending = snap.tasks.filter(
      (t) => t.status !== "completed" && t.status !== "deleted"
    );
    if (pending.length === 0) {
      _notifiedComplete.add(teamName);
      send("teams:allDone", { teamName, ...snap });
    }
  }
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

function watchPath(watchKey, dirPath, callback) {
  if (_watchers.has(watchKey)) return; // already watching
  ensureDir(dirPath);
  try {
    const watcher = fs.watch(dirPath, { recursive: true }, (event, filename) => {
      if (filename) callback(event, filename);
    });
    _watchers.set(watchKey, watcher);
  } catch {
    // path may not be accessible
  }
}

function startTeamWatch(teamName) {
  if (_watchers.has(`team:${teamName}`)) return;

  const teamDir  = path.join(TEAMS_DIR, teamName);
  const tasksDir = path.join(TASKS_DIR, teamName);

  // Debounce: emit snapshot at most once per 200 ms per team
  let debounceTimer = null;
  const scheduleSnapshot = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      emitFullSnapshot(teamName);
      debounceTimer = null;
    }, 200);
  };

  watchPath(`team:${teamName}`, teamDir, scheduleSnapshot);
  watchPath(`tasks:${teamName}`, tasksDir, scheduleSnapshot);

  // Initial snapshot
  emitFullSnapshot(teamName);
}

// Watch the top-level teams directory for new teams being created
function watchTeamsRoot() {
  if (_watchers.has("teams:root")) return;
  ensureDir(TEAMS_DIR);
  try {
    const watcher = fs.watch(TEAMS_DIR, (event, filename) => {
      if (!filename) return;
      // New subdirectory created → potential new team
      const teamName = filename.split(path.sep)[0];
      if (!teamName) return;
      const configPath = path.join(TEAMS_DIR, teamName, "config.json");
      // Wait briefly for config.json to be written
      setTimeout(() => {
        if (fs.existsSync(configPath)) {
          startTeamWatch(teamName);
        }
      }, 300);
    });
    _watchers.set("teams:root", watcher);
  } catch {
    // TEAMS_DIR may not exist on first run
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start watching. Call once after the BrowserWindow is ready.
 */
function init(webContents) {
  _webContents = webContents;
  ensureDir(TEAMS_DIR);
  ensureDir(TASKS_DIR);
  watchTeamsRoot();

  // Pick up any teams that already exist
  try {
    const entries = fs.readdirSync(TEAMS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(TEAMS_DIR, entry.name, "config.json");
      if (fs.existsSync(configPath)) {
        startTeamWatch(entry.name);
      }
    }
  } catch {
    // TEAMS_DIR doesn't exist yet
  }
}

/**
 * Manually trigger a fresh snapshot for a team (called after TeamCreate tool).
 */
function refreshTeam(teamName) {
  if (!teamName) return;
  startTeamWatch(teamName);
}

/**
 * Get a list of known active teams.
 */
function listTeams() {
  const teams = [];
  try {
    const entries = fs.readdirSync(TEAMS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const config = readTeamConfig(entry.name);
      if (config) teams.push({ teamName: entry.name, config });
    }
  } catch {
    // ignore
  }
  return teams;
}

/**
 * Get full snapshot for a single team on demand.
 */
function getTeamSnapshot(teamName) {
  return snapshotTeam(teamName);
}

/**
 * Clean up all watchers (call on app quit or window close).
 */
function destroy() {
  for (const watcher of _watchers.values()) {
    try { watcher.close(); } catch { /* ignore */ }
  }
  _watchers.clear();
  _state.clear();
  _notifiedComplete.clear();
  _webContents = null;
}

module.exports = { init, refreshTeam, listTeams, getTeamSnapshot, destroy };
