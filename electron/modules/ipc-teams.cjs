"use strict";

// ── IPC: Teams, Todos & Debug ────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ teams: any, fs: any, path: any, os: any, getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function register(ipcMain, { teams, fs, path, os, getMainWindow }) {
  // ── Teams ────────────────────────────────────────────────────────────────

  ipcMain.handle("teams:list", async () => {
    return teams.listTeams();
  });

  ipcMain.handle("teams:getSnapshot", async (_event, teamName) => {
    if (!teamName || typeof teamName !== "string") return null;
    return teams.getTeamSnapshot(teamName);
  });

  ipcMain.handle("teams:refresh", async (_event, teamName) => {
    if (!teamName || typeof teamName !== "string") return;
    teams.refreshTeam(teamName);
  });

  ipcMain.handle("teams:respondToPermission", async (_event, payload) => {
    const { teamName, agentId, requestId, behavior } = payload ?? {};
    if (!teamName || !agentId || !requestId || !behavior) return { ok: false };
    return teams.respondToPermission(teamName, agentId, requestId, behavior);
  });

  ipcMain.handle("teams:sendMessage", async (_event, payload) => {
    const { teamName, agentName, content } = payload ?? {};
    if (!teamName || !agentName || typeof content !== "string" || !content.trim()) return { ok: false };
    return teams.sendMessageToAgent(teamName, agentName, content);
  });

  ipcMain.handle("teams:deleteTeam", async (_event, teamName) => {
    if (!teamName || typeof teamName !== "string") return { ok: false };
    return teams.deleteTeam(teamName);
  });

  // ── Todos (Claude Code TodoWrite) ────────────────────────────────────────

  const TODOS_DIR = path.join(os.homedir(), ".claude", "todos");
  const activeTodosWatchers = new Map(); // sessionId -> { watcher, debounce }

  function readTodosFile(sessionId) {
    const filePath = path.join(TODOS_DIR, `${sessionId}-agent-${sessionId}.json`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, "utf-8").trim();
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  ipcMain.handle("todos:read", async (_event, sessionId) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) return [];
    return readTodosFile(sessionId.trim());
  });

  ipcMain.handle("todos:watch", async (event, sessionId) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) return;
    const id = sessionId.trim();

    // Stop any existing watcher for the same session
    const existing = activeTodosWatchers.get(id);
    if (existing) {
      clearTimeout(existing.debounce);
      try { existing.watcher.close(); } catch {}
      activeTodosWatchers.delete(id);
    }

    // Send initial state immediately
    if (!event.sender.isDestroyed()) {
      event.sender.send("todos:update", { sessionId: id, todos: readTodosFile(id) });
    }

    // Watch directory for changes to our file
    if (!fs.existsSync(TODOS_DIR)) return;
    const targetFile = `${id}-agent-${id}.json`;
    let debounce = null;

    try {
      const watcher = fs.watch(TODOS_DIR, (_, filename) => {
        if (!filename || filename !== targetFile) return;
        if (event.sender.isDestroyed()) {
          watcher.close();
          activeTodosWatchers.delete(id);
          return;
        }
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("todos:update", { sessionId: id, todos: readTodosFile(id) });
          }
        }, 150);
      });
      activeTodosWatchers.set(id, { watcher, debounce });
    } catch { /* TODOS_DIR not watchable */ }
  });

  ipcMain.handle("todos:unwatch", async (_event, sessionId) => {
    if (typeof sessionId !== "string") return;
    const entry = activeTodosWatchers.get(sessionId.trim());
    if (entry) {
      clearTimeout(entry.debounce);
      try { entry.watcher.close(); } catch {}
      activeTodosWatchers.delete(sessionId.trim());
    }
  });

  // ── Debug ────────────────────────────────────────────────────────────────

  ipcMain.handle("debug:openDevTools", () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });
}

module.exports = { register };
