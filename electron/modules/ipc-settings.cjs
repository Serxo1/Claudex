"use strict";

// ── IPC: Settings & Providers ────────────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ settings: any }} deps
 */
function register(ipcMain, { settings }) {
  ipcMain.handle("settings:get", async () => {
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:setAuthMode", async (_event, authMode) => {
    if (authMode !== settings.AUTH_MODES.API_KEY && authMode !== settings.AUTH_MODES.CLAUDE_CLI) {
      throw new Error("Invalid auth mode.");
    }

    const current = settings.readSettings();
    settings.writeSettings({ ...current, authMode });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:setModel", async (_event, model) => {
    if (typeof model !== "string" || !model.trim()) {
      throw new Error("Model cannot be empty.");
    }

    const current = settings.readSettings();
    settings.writeSettings({ ...current, model: model.trim() });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:setPreferredIde", async (_event, ideId) => {
    if (typeof ideId !== "string" || !ideId.trim()) {
      throw new Error("Invalid IDE id.");
    }

    const current = settings.readSettings();
    settings.writeSettings({ ...current, preferredIde: ideId.trim() });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:setApiKey", async (_event, apiKey) => {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("API key cannot be empty.");
    }

    const current = settings.readSettings();
    settings.writeSettings({
      ...current,
      encryptedApiKey: settings.encryptSecret(apiKey.trim())
    });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:clearApiKey", async () => {
    const current = settings.readSettings();
    settings.writeSettings({
      ...current,
      encryptedApiKey: ""
    });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("settings:clearClaudeCliSession", async () => {
    const current = settings.readSettings();
    settings.writeSettings({
      ...current,
      claudeCliSessionId: ""
    });
    return settings.publicSettings(settings.readSettings());
  });

  ipcMain.handle("providers:testClaudeCli", async () => {
    const { spawn } = require("node:child_process");
    return new Promise((resolve) => {
      // Use the user's login shell so that PATH includes npm/nvm global bins
      // (GUI apps launched from Finder inherit a minimal PATH that may miss them)
      const userShell = process.env.SHELL || "/bin/zsh";
      // -i = interactive shell, sources ~/.zshrc where nvm/npm global paths live
      const child = spawn(userShell, ["-i", "-c", "claude --version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", () => {
        resolve({
          ok: false,
          message: 'Claude CLI not found. Install it and run "claude login".'
        });
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({
            ok: true,
            message: stdout.trim() || "Claude CLI detected."
          });
          return;
        }

        resolve({
          ok: false,
          message: stderr.trim() || `Claude CLI returned exit code ${code}.`
        });
      });
    });
  });
}

module.exports = { register };
