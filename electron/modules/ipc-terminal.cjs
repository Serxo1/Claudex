"use strict";

// ── IPC: Terminal ────────────────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ terminal: any, runCommand: Function, logError: Function, WORKSPACE_DIR: string, randomUUID: () => string }} deps
 */
function register(ipcMain, { terminal, runCommand, logError, WORKSPACE_DIR, randomUUID }) {
  ipcMain.handle("terminal:createSession", async (event, payload = {}) => {
    const cols =
      Number.isFinite(Number(payload.cols)) && Number(payload.cols) > 0 ? Math.floor(Number(payload.cols)) : 120;
    const rows =
      Number.isFinite(Number(payload.rows)) && Number(payload.rows) > 0 ? Math.floor(Number(payload.rows)) : 30;

    const shell = terminal.resolveTerminalShell();
    const cwd = (typeof payload.cwd === "string" && payload.cwd) ? payload.cwd : terminal.resolveTerminalCwd(require("electron").app.getPath("home"));
    const env = terminal.buildTerminalEnv();
    let terminalSession;
    let launchWarning = "";

    try {
      terminalSession = terminal.spawnPtyShellSession(shell, cwd, env, cols, rows);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      terminalSession = terminal.spawnPipeShellSession(shell, cwd, env);
      launchWarning = `PTY unavailable (${detail}). Running in compatibility mode.`;
    }

    const sessionId = randomUUID();
    const sender = event.sender;
    terminal.activeTerminalSessions.set(sessionId, {
      process: terminalSession.process,
      sender
    });

    terminalSession.process.onData((data) => {
      if (!sender || sender.isDestroyed()) {
        terminal.closeTerminalSession(sessionId);
        return;
      }
      sender.send("terminal:data", { sessionId, data });
    });

    terminalSession.process.onExit((exitEvent) => {
      if (sender && !sender.isDestroyed()) {
        sender.send("terminal:exit", {
          sessionId,
          exitCode: exitEvent?.exitCode ?? 0,
          signal: exitEvent?.signal ?? 0
        });
      }
      terminal.activeTerminalSessions.delete(sessionId);
    });

    if (launchWarning) {
      sender.send("terminal:data", { sessionId, data: `\r\n[${launchWarning}]\r\n` });
    }

    return { sessionId, cwd, shell: terminalSession.shell };
  });

  ipcMain.handle("terminal:write", async (_event, payload = {}) => {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const data = typeof payload.data === "string" ? payload.data : "";
    const session = terminal.activeTerminalSessions.get(sessionId);
    if (!session) {
      return { ok: false };
    }
    session.process.write(data);
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", async (_event, payload = {}) => {
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const cols =
      Number.isFinite(Number(payload.cols)) && Number(payload.cols) > 0 ? Math.floor(Number(payload.cols)) : 120;
    const rows =
      Number.isFinite(Number(payload.rows)) && Number(payload.rows) > 0 ? Math.floor(Number(payload.rows)) : 30;
    const session = terminal.activeTerminalSessions.get(sessionId);
    if (!session) {
      return { ok: false };
    }
    try {
      session.process.resize(cols, rows);
    } catch (error) {
      logError("terminal:resize", error);
      return { ok: false };
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:close", async (_event, sessionId) => {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return { ok: false };
    }
    terminal.closeTerminalSession(sessionId);
    return { ok: true };
  });

  ipcMain.handle("terminal:openExternal", async () => {
    const openResult = await runCommand("open", ["-a", "Terminal", WORKSPACE_DIR], {
      cwd: WORKSPACE_DIR
    });
    if (openResult.code !== 0) {
      throw new Error(openResult.stderr.trim() || "Unable to open Terminal.");
    }
    return { ok: true };
  });
}

module.exports = { register };
