const { app, BrowserWindow, ipcMain, nativeImage, safeStorage, dialog, globalShortcut } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

// Suppress "Operation aborted" rejections from the Claude Agent SDK when a
// stream is aborted while a tool-approval promise is still pending.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && reason.message === "Operation aborted") return;
  console.error("Unhandled rejection:", reason);
});

async function createRoundedDockIcon() {
  const logoPath = path.join(__dirname, "../public/logo.png");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");
  const logoDataURL = `data:image/png;base64,${logoBase64}`;

  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true }
  });

  await new Promise((resolve) => {
    win.loadURL("data:text/html,<html><body style='margin:0'><canvas id='c' width='256' height='256'></canvas></body></html>");
    win.webContents.once("did-finish-load", resolve);
  });

  const dataURL = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        const size = 256, r = 56;
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(size, 0, size, size, r);
        ctx.arcTo(size, size, 0, size, r);
        ctx.arcTo(0, size, 0, 0, r);
        ctx.arcTo(0, 0, size, 0, r);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = '${logoDataURL}';
    })
  `);

  win.destroy();
  return nativeImage.createFromDataURL(dataURL);
}

const { setWorkspaceDir, runCommand, isCommandAvailable } = require("./modules/utils.cjs");
const settings = require("./modules/settings.cjs");
const workspace = require("./modules/workspace.cjs");
const git = require("./modules/git.cjs");
const ide = require("./modules/ide.cjs");
const terminal = require("./modules/terminal.cjs");
const chat = require("./modules/chat.cjs");
const skills = require("./modules/skills.cjs");
const { logError } = require("./modules/logger.cjs");
const { MAX_EDITOR_FILE_SIZE, PR_TIMEOUT_MS, TEMP_PASTE_DIR } = require("./modules/constants.cjs");

const WORKSPACE_DIR = process.cwd();

setWorkspaceDir(WORKSPACE_DIR);
settings.init(app, safeStorage);

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: "Claude Desktop MVP",
    icon: path.join(__dirname, "../public/logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    createRoundedDockIcon().then((icon) => app.dock.setIcon(icon)).catch(() => {
      app.dock.setIcon(path.join(__dirname, "../public/logo.png"));
    });
  }

  createWindow();

  // ── Settings ──────────────────────────────────────────────────────────

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

  // ── Providers ─────────────────────────────────────────────────────────

  ipcMain.handle("providers:testClaudeCli", async () => {
    const { spawn } = require("node:child_process");
    return new Promise((resolve) => {
      const child = spawn("claude", ["--version"], {
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

  // ── Workspace ─────────────────────────────────────────────────────────

  ipcMain.handle("workspace:getInfo", async () => {
    const current = settings.readSettings();
    const roots = workspace.getWorkspaceRoots(current);
    return {
      path: WORKSPACE_DIR,
      name: path.basename(WORKSPACE_DIR),
      roots
    };
  });

  ipcMain.handle("workspace:getFileTree", async (_event, payload = {}) => {
    return workspace.readWorkspaceFileTree(WORKSPACE_DIR, payload);
  });

  ipcMain.handle("workspace:getFileTrees", async (_event, payload = {}) => {
    const current = settings.readSettings();
    const roots = workspace.getWorkspaceRoots(current);
    return roots.map((rootPath) => {
      const tree = workspace.readWorkspaceFileTree(rootPath, payload);
      return {
        rootPath,
        rootName: path.basename(rootPath),
        nodes: tree.nodes,
        truncated: tree.truncated
      };
    });
  });

  ipcMain.handle("workspace:addDirectory", async () => {
    const current = settings.readSettings();
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dirs: workspace.normalizeAdditionalWorkspaceDirs(current.workspaceDirs) };
    }
    const picked = path.resolve(result.filePaths[0]);
    const nextDirs = workspace.normalizeAdditionalWorkspaceDirs([...(current.workspaceDirs || []), picked]);
    settings.writeSettings({ ...current, workspaceDirs: nextDirs });
    return { ok: true, path: picked, dirs: nextDirs };
  });

  ipcMain.handle("workspace:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, path: null };
    return { ok: true, path: path.resolve(result.filePaths[0]) };
  });

  ipcMain.handle("workspace:removeDirectory", async (_event, dirPath) => {
    const current = settings.readSettings();
    const toRemove = typeof dirPath === "string" ? path.resolve(dirPath) : "";
    const nextDirs = workspace.normalizeAdditionalWorkspaceDirs(current.workspaceDirs).filter((dir) => dir !== toRemove);
    settings.writeSettings({ ...current, workspaceDirs: nextDirs });
    return { ok: true, dirs: nextDirs };
  });

  ipcMain.handle("workspace:pickContextFile", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: WORKSPACE_DIR,
      properties: ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const absolutePath = result.filePaths[0];
    return workspace.toContextFilePayload(absolutePath);
  });

  ipcMain.handle("workspace:resolveContextFile", async (_event, relativePath) => {
    const current = settings.readSettings();
    const normalizedAbsolute = workspace.resolveWorkspaceFilePath(relativePath, current);
    if (!fs.existsSync(normalizedAbsolute)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(normalizedAbsolute);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    return workspace.toContextFilePayload(normalizedAbsolute);
  });

  ipcMain.handle("workspace:readFile", async (_event, filePath) => {
    const current = settings.readSettings();
    const absolutePath = workspace.resolveWorkspaceFilePath(filePath, current);
    if (!fs.existsSync(absolutePath)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    if (stat.size > MAX_EDITOR_FILE_SIZE) {
      throw new Error("File too large to open in editor.");
    }
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) {
      throw new Error("Binary files are not supported in this editor.");
    }
    const content = buffer.toString("utf8");
    return {
      absolutePath,
      relativePath: path.relative(WORKSPACE_DIR, absolutePath) || path.basename(absolutePath),
      content
    };
  });

  ipcMain.handle("workspace:writeFile", async (_event, payload = {}) => {
    const current = settings.readSettings();
    const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
    const content = typeof payload.content === "string" ? payload.content : "";
    const absolutePath = workspace.resolveWorkspaceFilePath(filePath, current);
    if (!fs.existsSync(absolutePath)) {
      throw new Error("File does not exist.");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("Path is not a file.");
    }
    fs.writeFileSync(absolutePath, content, "utf8");
    return {
      ok: true,
      absolutePath,
      relativePath: path.relative(WORKSPACE_DIR, absolutePath) || path.basename(absolutePath)
    };
  });

  ipcMain.handle("workspace:savePastedImage", async (_event, payload) => {
    const dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl.trim() : "";
    if (!dataUrl) {
      throw new Error("Missing pasted image data.");
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid pasted image format.");
    }

    const mediaType = match[1].toLowerCase();
    if (!mediaType.startsWith("image/")) {
      throw new Error("Only image paste is supported.");
    }

    const base64 = match[2];
    const raw = Buffer.from(base64, "base64");
    const ext = workspace.extensionForMediaType(mediaType);
    const preferredName = workspace.sanitizeFileName(payload?.filename || "pasted-image");
    const filename = preferredName.endsWith(ext) ? preferredName : `${preferredName}${ext}`;
    const rootDir = path.join(app.getPath("temp"), TEMP_PASTE_DIR);
    fs.mkdirSync(rootDir, { recursive: true });
    const absolutePath = path.join(rootDir, `${Date.now()}-${randomUUID()}-${filename}`);
    fs.writeFileSync(absolutePath, raw);

    return {
      absolutePath,
      relativePath: path.basename(absolutePath),
      mediaType,
      isImage: true,
      previewDataUrl: dataUrl
    };
  });

  // ── IDE ───────────────────────────────────────────────────────────────

  ipcMain.handle("ide:getInfo", async () => {
    const current = settings.readSettings();
    const available = await ide.listAvailableIdes();
    const selected =
      available.find((i) => i.id === current.preferredIde) ||
      available[0] ||
      ide.IDE_CANDIDATES[0];

    return {
      available,
      selectedId: selected.id
    };
  });

  ipcMain.handle("ide:openProject", async (_event, payload) => {
    // payload can be a plain ideId string (legacy) or { ideId, workspaceDir }
    const ideId = typeof payload === "string" ? payload : payload?.ideId;
    const workspaceDir = typeof payload === "object" && payload?.workspaceDir ? payload.workspaceDir : undefined;

    const available = await ide.listAvailableIdes();
    const byId = available.find((i) => i.id === ideId);
    const current = settings.readSettings();
    const selected =
      byId ||
      available.find((i) => i.id === current.preferredIde) ||
      available[0];

    if (!selected) {
      throw new Error("No supported IDE found on PATH.");
    }

    ide.launchIde(selected, workspaceDir);
    settings.writeSettings({ ...current, preferredIde: selected.id });
    return { ok: true, ideId: selected.id };
  });

  // ── Git ───────────────────────────────────────────────────────────────

  ipcMain.handle("git:getSummary", async () => {
    return git.getGitSummary();
  });

  ipcMain.handle("git:getRecentCommits", async (_event, limit) => {
    return git.getRecentGitCommits(limit);
  });

  ipcMain.handle("git:initRepo", async () => {
    const alreadyRepo = await git.isGitRepository();
    if (alreadyRepo) {
      return git.getGitSummary();
    }

    const initResult = await runCommand("git", ["init"], { cwd: WORKSPACE_DIR });
    if (initResult.code !== 0) {
      throw new Error(initResult.stderr.trim() || initResult.stdout.trim() || "Unable to initialize git repository.");
    }

    return git.getGitSummary();
  });

  ipcMain.handle("git:checkoutBranch", async (_event, branchName) => {
    if (typeof branchName !== "string" || !branchName.trim()) {
      throw new Error("Invalid branch name.");
    }

    const checkout = await runCommand("git", ["checkout", branchName.trim()], {
      cwd: WORKSPACE_DIR
    });
    if (checkout.code !== 0) {
      throw new Error(checkout.stderr.trim() || checkout.stdout.trim() || "Unable to checkout branch.");
    }

    return git.getGitSummary();
  });

  ipcMain.handle("git:commit", async (_event, message) => {
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Commit message cannot be empty.");
    }

    const addResult = await runCommand("git", ["add", "-A"], { cwd: WORKSPACE_DIR });
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr.trim() || "Unable to stage files.");
    }

    const commitResult = await runCommand("git", ["commit", "-m", message.trim()], {
      cwd: WORKSPACE_DIR
    });
    if (commitResult.code !== 0) {
      const detail = commitResult.stderr.trim() || commitResult.stdout.trim();
      throw new Error(detail || "Commit failed.");
    }

    return {
      ok: true,
      output: commitResult.stdout.trim() || commitResult.stderr.trim(),
      summary: await git.getGitSummary()
    };
  });

  ipcMain.handle("git:createPr", async (_event, payload = {}) => {
    const hasGh = await isCommandAvailable("gh");
    if (!hasGh) {
      throw new Error("GitHub CLI (gh) not found. Install it and run gh auth login.");
    }

    const args = ["pr", "create", "--fill"];
    if (typeof payload.title === "string" && payload.title.trim()) {
      args.push("--title", payload.title.trim());
    }
    if (typeof payload.body === "string" && payload.body.trim()) {
      args.push("--body", payload.body.trim());
    }
    if (typeof payload.base === "string" && payload.base.trim()) {
      args.push("--base", payload.base.trim());
    }

    const prResult = await runCommand("gh", args, {
      cwd: WORKSPACE_DIR,
      timeoutMs: PR_TIMEOUT_MS
    });
    if (prResult.code !== 0) {
      const detail = prResult.stderr.trim() || prResult.stdout.trim();
      throw new Error(detail || "Unable to create pull request.");
    }

    return {
      ok: true,
      output: prResult.stdout.trim() || "Pull request created."
    };
  });

  // ── Terminal ──────────────────────────────────────────────────────────

  ipcMain.handle("terminal:createSession", async (event, payload = {}) => {
    const cols =
      Number.isFinite(Number(payload.cols)) && Number(payload.cols) > 0 ? Math.floor(Number(payload.cols)) : 120;
    const rows =
      Number.isFinite(Number(payload.rows)) && Number(payload.rows) > 0 ? Math.floor(Number(payload.rows)) : 30;

    const shell = terminal.resolveTerminalShell();
    const cwd = (typeof payload.cwd === "string" && payload.cwd) ? payload.cwd : terminal.resolveTerminalCwd(app.getPath("home"));
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

  // ── Chat ──────────────────────────────────────────────────────────────

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

  ipcMain.handle("workspace:getSkills", async () => {
    try {
      return { ok: true, skills: skills.getAvailableSkills() };
    } catch {
      return { ok: false, skills: [] };
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
      const expanded = skills.expandSlashCommand(msg.content);
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

  // ── Debug ─────────────────────────────────────────────────────────────

  ipcMain.handle("debug:openDevTools", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // ── App lifecycle ─────────────────────────────────────────────────────

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("browser-window-focus", () => {
    globalShortcut.register("F12", () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) win.webContents.toggleDevTools();
    });
  });

  app.on("browser-window-blur", () => {
    globalShortcut.unregister("F12");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const active of chat.activeStreamRequests.values()) {
    try {
      active.aborted = true;
      active.abort();
    } catch (error) {
      logError("app:before-quit:stream", error);
    }
  }
  chat.activeStreamRequests.clear();

  for (const sessionId of terminal.activeTerminalSessions.keys()) {
    terminal.closeTerminalSession(sessionId);
  }
  terminal.activeTerminalSessions.clear();
});
