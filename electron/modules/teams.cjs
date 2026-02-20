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

// External subscribers (ACP gateway, IBM ACP gateway)
// callback(event: "snapshot" | "allDone", teamName: string, snap: object)
const _subscribers = new Set();


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
  for (const sub of _subscribers) {
    try { sub("snapshot", teamName, snap); } catch { /* ignore */ }
  }

  // Fire "allDone" once — two conditions (whichever comes first):
  // 1. All tasks (≥1) reached completed/deleted status (agent called TaskUpdate)
  // 2. All non-lead members have sent at least one real message to team-lead inbox
  //    (agent reported results but forgot/skipped TaskUpdate)
  if (!_notifiedComplete.has(teamName)) {
    let shouldFire = false;

    // Condition 1: task-status-based
    if (snap.tasks.length > 0) {
      const pending = snap.tasks.filter(
        (t) => t.status !== "completed" && t.status !== "deleted"
      );
      if (pending.length === 0) shouldFire = true;
    }

    // Condition 2: inbox-based (all non-lead agents reported back)
    if (!shouldFire && snap.config && Array.isArray(snap.config.members)) {
      const nonLeadMembers = snap.config.members.filter(
        (m) => m.agentType !== "team-lead"
      );
      if (nonLeadMembers.length > 0) {
        const leadInbox = (snap.inboxes && snap.inboxes["team-lead"]) || [];
        const realMsgSenders = new Set(
          leadInbox
            .filter((msg) => {
              try {
                const p = JSON.parse(msg.text);
                return (
                  p.type !== "idle_notification" &&
                  p.type !== "permission_request" &&
                  p.type !== "shutdown_request"
                );
              } catch {
                return true; // plain text = real message
              }
            })
            .map((msg) => msg.from)
        );
        if (nonLeadMembers.every((m) => realMsgSenders.has(m.name))) {
          shouldFire = true;
        }
      }
    }

    if (shouldFire) {
      _notifiedComplete.add(teamName);
      send("teams:allDone", { teamName, ...snap });
      for (const sub of _subscribers) {
        try { sub("allDone", teamName, snap); } catch { /* ignore */ }
      }
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
  // Limpar estado para permitir allDone numa equipa recriada
  _notifiedComplete.delete(teamName);
  // Fechar watchers antigos (podem estar obsoletos após TeamDelete)
  for (const key of [`team:${teamName}`, `tasks:${teamName}`]) {
    if (_watchers.has(key)) {
      try { _watchers.get(key).close(); } catch {}
      _watchers.delete(key);
    }
  }
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

/**
 * Respond to a permission_request from a background agent.
 * Writes a permission_response to the agent's own inbox.
 *
 * @param {string} teamName
 * @param {string} agentId  - e.g. "tool-checker" or "tool-checker@team-name"
 * @param {string} requestId - the request_id from the permission_request message
 * @param {"allow"|"deny"} behavior
 */
function respondToPermission(teamName, agentId, requestId, behavior) {
  // Strip @team suffix if present
  const shortName = agentId.includes("@") ? agentId.split("@")[0] : agentId;
  const inboxPath = path.join(TEAMS_DIR, teamName, "inboxes", `${shortName}.json`);

  const responsePayload =
    behavior === "allow"
      ? {
          type: "permission_response",
          request_id: requestId,
          subtype: "success",
          response: { updated_input: null, permission_updates: [] }
        }
      : {
          type: "permission_response",
          request_id: requestId,
          subtype: "error",
          error: "Permission denied by user"
        };

  const message = {
    from: "team-lead",
    text: JSON.stringify(responsePayload),
    timestamp: new Date().toISOString(),
    read: false
  };

  try {
    const existing = safeReadJson(inboxPath);
    const arr = Array.isArray(existing) ? existing : [];
    arr.push(message);
    fs.writeFileSync(inboxPath, JSON.stringify(arr, null, 2), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Remove os directórios da equipa (~/.claude/teams/{team} e ~/.claude/tasks/{team}).
 * Equivalente ao que a tool TeamDelete faz, mas chamado pelo nosso código.
 */
function deleteTeam(teamName) {
  if (!teamName) return { ok: false, error: "teamName required" };
  // Fechar watchers antes de apagar
  for (const key of [`team:${teamName}`, `tasks:${teamName}`]) {
    if (_watchers.has(key)) {
      try { _watchers.get(key).close(); } catch {}
      _watchers.delete(key);
    }
  }
  _notifiedComplete.delete(teamName);
  _state.delete(teamName);
  try {
    const teamDir  = path.join(TEAMS_DIR, teamName);
    const tasksDir = path.join(TASKS_DIR, teamName);
    if (fs.existsSync(teamDir))  fs.rmSync(teamDir,  { recursive: true, force: true });
    if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Envia uma mensagem de texto do utilizador para a inbox de um agente.
 * O agente recebe como tipo "message" com from="user".
 */
function sendMessageToAgent(teamName, agentName, content) {
  const inboxPath = path.join(TEAMS_DIR, teamName, "inboxes", `${agentName}.json`);
  const message = {
    from: "user",
    text: JSON.stringify({ type: "message", content, from: "user" }),
    summary: content.slice(0, 100),
    timestamp: new Date().toISOString(),
    read: false
  };
  ensureDir(path.dirname(inboxPath));
  try {
    const existing = safeReadJson(inboxPath);
    const arr = Array.isArray(existing) ? existing : [];
    arr.push(message);
    fs.writeFileSync(inboxPath, JSON.stringify(arr, null, 2), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Subscribe to snapshot/allDone events from any team.
 * Returns an unsubscribe function.
 * @param {function(event: string, teamName: string, snap: object): void} callback
 */
function subscribe(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

module.exports = { init, refreshTeam, listTeams, getTeamSnapshot, respondToPermission, sendMessageToAgent, deleteTeam, destroy, subscribe };
