"use strict";

// ── IPC: Chat, Notifications & MCP ──────────────────────────────────────────

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ chat: any, settings: any, workspace: any, skills: any, app: any, shell: any, fs: any, path: any, Notification: any, randomUUID: () => string, getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function register(ipcMain, { chat, settings, workspace, skills, app, shell, fs, path, Notification, randomUUID, getMainWindow }) {
  // ── Chat ────────────────────────────────────────────────────────────────

  ipcMain.handle("chat:send", async (_event, payload) => {
    const { messages, effort, contextFiles } = chat.parseChatPayload(payload);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Cannot send an empty chat.");
    }

    const current = settings.readSettings();
    const workspaceDirs = workspace.getWorkspaceRoots(current);

    if (current.authMode === settings.AUTH_MODES.API_KEY) {
      const apiKey = settings.decryptSecret(current.encryptedApiKey);
      if (!apiKey) {
        throw new Error("No API key configured.");
      }

      const content = await chat.runAnthropicApi(messages, current.model, apiKey);
      return { content, provider: "anthropic-api" };
    }

    const hasImageContext = contextFiles.some((file) => file.isImage);
    const resumeSessionId = hasImageContext ? "" : current.claudeCliSessionId;
    const forcedSessionId = hasImageContext ? randomUUID() : "";

    try {
      const result = await chat.runClaudeCli(
        messages,
        current.model,
        resumeSessionId,
        effort,
        contextFiles,
        forcedSessionId,
        workspaceDirs
      );
      if (result.sessionId && result.sessionId !== current.claudeCliSessionId) {
        settings.writeSettings({ ...current, claudeCliSessionId: result.sessionId });
      }

      return { content: result.content, provider: "claude-cli" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Claude CLI error.";
      if (current.claudeCliSessionId && chat.isRecoverableResumeError(message)) {
        const reset = { ...current, claudeCliSessionId: "" };
        settings.writeSettings(reset);
        const retried = await chat.runClaudeCli(messages, current.model, "", effort, contextFiles, randomUUID(), workspaceDirs);
        if (retried.sessionId) {
          settings.writeSettings({ ...reset, claudeCliSessionId: retried.sessionId });
        }
        return { content: retried.content, provider: "claude-cli" };
      }

      throw error;
    }
  });

  ipcMain.handle("chat:streamStart", async (event, payload) => {
    const { messages, effort, contextFiles, resumeSessionId: clientResumeSessionId, workspaceDirs: payloadWorkspaceDirs } = chat.parseChatPayload(payload);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Cannot send an empty chat.");
    }

    // Expand the last user message if it's a skill/command slash invocation
    const expandedMessages = messages.map((msg, i) => {
      if (i !== messages.length - 1 || msg.role !== "user") return msg;
      const expanded = skills.expandLegacyCommand(msg.content);
      return expanded ? { ...msg, content: expanded } : msg;
    });

    const requestId = randomUUID();
    const current = settings.readSettings();
    // Use thread-specific dirs if provided, otherwise fall back to global workspace dirs
    const workspaceDirs = payloadWorkspaceDirs.length > 0 ? payloadWorkspaceDirs : workspace.getWorkspaceRoots(current);

    if (current.authMode === settings.AUTH_MODES.API_KEY) {
      const apiKey = settings.decryptSecret(current.encryptedApiKey);
      if (!apiKey) {
        throw new Error("No API key configured.");
      }

      chat.startAnthropicPseudoStream({
        webContents: event.sender,
        requestId,
        messages: expandedMessages,
        model: current.model,
        apiKey
      });
      return { requestId, provider: "anthropic-api" };
    }

    const hasImageContext = contextFiles.some((file) => file.isImage);
    // Use client-provided resumeSessionId when payload is an object (renderer explicitly set it,
    // even if empty string meaning "start fresh"). Only fall back to global session when payload
    // was the legacy array format (no resumeSessionId field present).
    const clientExplicitlyProvided = !Array.isArray(payload) && payload && typeof payload.resumeSessionId === "string";
    const resumeSessionId = hasImageContext ? "" : (clientExplicitlyProvided ? clientResumeSessionId : current.claudeCliSessionId);
    const forcedSessionId = hasImageContext ? randomUUID() : "";

    void chat.startSDKStream({
      webContents: event.sender,
      requestId,
      messages: expandedMessages,
      model: current.model,
      effort,
      contextFiles,
      workspaceDirs,
      forcedSessionId,
      resumeSessionId,
      onSessionId: (sessionId) => {
        const latest = settings.readSettings();
        if (latest.claudeCliSessionId !== sessionId) {
          settings.writeSettings({ ...latest, claudeCliSessionId: sessionId });
        }
      },
      onSessionReset: () => {
        const latest = settings.readSettings();
        if (latest.claudeCliSessionId) {
          settings.writeSettings({ ...latest, claudeCliSessionId: "" });
        }
      }
    });
    return { requestId, provider: "claude-cli" };
  });

  ipcMain.handle("chat:streamAbort", async (_event, requestId) => {
    const active = chat.activeStreamRequests.get(requestId);
    if (!active) {
      return { ok: false };
    }

    active.aborted = true;
    active.abort();
    return { ok: true };
  });

  ipcMain.handle("chat:approvalResponse", (_event, approvalId, response) => {
    if (typeof approvalId !== "string") return { ok: false };
    const ok = chat.resolveApproval(approvalId, response);
    return { ok };
  });

  // ── Notifications ────────────────────────────────────────────────────────

  ipcMain.handle("app:notify", (_event, payload = {}) => {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: typeof payload.title === "string" ? payload.title : "Claudex",
          body: typeof payload.body === "string" ? payload.body : "",
          silent: false
        });
        n.on("click", () => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        });
        n.show();
      }
    } catch {
      // Ignore
    }
    return { ok: true };
  });

  // ── MCP servers ──────────────────────────────────────────────────────────

  ipcMain.handle("mcp:getServers", () => {
    try {
      // Use app.getPath("home") — guaranteed to be correct in Electron
      const homeDir = app.getPath("home");
      const settingsPath = path.join(homeDir, ".claude", "settings.json");

      if (!fs.existsSync(settingsPath)) return [];

      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const results = [];

      // enabledPlugins: { "name@source": true, ... }
      const enabledPlugins = parsed.enabledPlugins || {};
      for (const [key, enabled] of Object.entries(enabledPlugins)) {
        if (!enabled) continue;
        const atIdx = key.lastIndexOf("@");
        results.push({
          name: atIdx >= 0 ? key.slice(0, atIdx) : key,
          type: "plugin",
          enabled: true,
          status: "connected",
          command: "",
          description: atIdx >= 0 ? key.slice(atIdx + 1) : ""
        });
      }

      // mcpServers: { "name": { command, args, ... }, ... }
      const mcpServers = parsed.mcpServers || {};
      for (const [name, config] of Object.entries(mcpServers)) {
        results.push({
          name,
          type: "mcp",
          enabled: true,
          status: "disconnected",
          command: Array.isArray(config.args)
            ? `${config.command || ""} ${config.args.join(" ")}`.trim()
            : (config.command || ""),
          description: config.description || ""
        });
      }

      return results;
    } catch {
      return [];
    }
  });

  ipcMain.handle("mcp:openConfigFile", async () => {
    try {
      const os = require("node:os");
      const configPath = path.join(os.homedir(), ".claude", "settings.json");
      // Create file with empty mcpServers if it doesn't exist
      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
      }
      await shell.openPath(configPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { register };
